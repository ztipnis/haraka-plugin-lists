'use strict';
const constants = require('haraka-constants');

exports.register = function () {
    const plugin = this;
    plugin.load_lists_ini();
    if(plugin.cfg.main.enabled === true){
        plugin.loginfo("Plugin Lists Enabled",null)
        plugin.register_hook('init_master','init_pool');
        plugin.register_hook('connect_init', 'init_client');
        plugin.register_hook('rcpt', 'validate_address');
        plugin.register_hook('queue', 'load_recipients');
        plugin.register_hook('queue', 'log_rcpt');
        plugin.register_hook('disconnect', 'close_client')

    }
}

exports.load_lists_ini = function () {
    const plugin = this;

    plugin.cfg = plugin.config.get('lists.ini', {
        booleans: [
            '+enabled',               // plugin.cfg.main.enabled=true
        ]
    },
    function () {
        plugin.load_example_ini();
    });
}

exports.init_pool = function(next, server){
    const plugin = this;
    const { Pool } = require('pg');
    plugin.db_pool_postgres = new Pool();
    plugin.db_pool_postgres.on('error', (err, client) =>{
        plugin.logcrit('Idle client encountered error ' + err)
    })
    next()
}

exports.init_client = function(next, connection){
    const plugin = this;
    if(!(typeof plugin.db_pool_postgres !== 'undefined' && db_pool_postgres)){
        const { Pool } = require('pg');
        plugin.db_pool_postgres = new Pool();
        plugin.db_pool_postgres.on('error', (err, client) =>{
            plugin.logcrit('Idle client encountered error ' + err.message)
        })
    }
    if(plugin.db_pool_postgres){
        plugin.db_pool_postgres.connect().then(client => {
            connection.notes.pgresClient = client;
            next();
        }).catch(e =>{
            connection.logerror("List plugin failed to create client");
        })
    }
}

exports.validate_address = function(next, connection, params){
    const plugin = this;
    const util = require('util');
    var recipient = params[0].user + "@" + params[0].host;
    connection.logdebug("Checking for list named " + util.inspect(recipient))
    this.lookup(connection.notes.pgresClient, recipient, (valid) => {
        if(valid){
            connection.logdebug("List named: '" + recipient +"' exists!")
            connection.notes.islist = true;
            return next(constants.OK);
        }else{
            connection.logdebug("List does not exist");
            connection.notes.islist = false;
            return next(constants.CONT);
        }
    })
}

exports.hook_data = function(next, connection){
    connection.transaction.parse_body = true;
    next();
}

exports.load_recipients = function (next, connection){
    const plugin = this;
    var Address = require('address-rfc2821').Address;
    if(connection.notes.islist == true){
        var recipients = connection.transaction.rcpt_to;
        plugin.logdebug(recipients);
        connection.transaction.rcpt_to = [];
        const rcpts = recipients.map(async (rcpnt) => {
            plugin.logdebug(rcpnt);
            var is_list = await plugin.lookup_async(connection.notes.pgresClient, rcpnt.user + "@" + rcpnt.host)
            if(!is_list){
                plugin.logdebug(rcpnt.user + "@" + rcpnt.host + " is not a list!")
                return connection.transaction.rcpt_to.push(rcpnt)
            } else{
                plugin.logdebug("Looking up list users...")
                var rpnts = await plugin.list_recipients(connection.notes.pgresClient, rcpnt.user + "@" + rcpnt.host);
                return rpnts.forEach(rpnt =>{
                    var adr = new Address(rpnt);
                    plugin.logdebug(adr);
                    connection.transaction.rcpt_to.push(adr);
                })
            }
        })
        Promise.all(rcpts).then(() => {
            next(constants.CONT);
        })
    }
}
exports.log_rcpt = function (next, connection){
    this.logdebug(connection.transaction.rcpt_to);
}

exports.close_client = function(next, connection){
    if(typeof connection.notes.pgresClient !== 'undefined' && connection.notes.pgresClient){
        connection.notes.pgresClient.release()
    }
    next();
}

exports.list_recipients = function( client, address ){
    const plugin = this;
    return new Promise(function(resolve){
        if(client){
            client.query("SELECT list_users.users FROM lists RIGHT JOIN list_users ON lists.id=list_users.id WHERE lists.address = $1", [address], (err,result) => {
                if(err){
                    plugin.logerror("Lookup recipients for list "+ address + " failed. " + err)
                    resolve([]);
                }
                if(result.rowCount <= 0){

                    resolve([]);
                }else{
                    resolve(result.rows[0].users)
                }
            })
        }
    })
}

exports.lookup_async = function( client, address ){
    return new Promise(function(resolve){
        if(client){
            client.query("SELECT * FROM lists WHERE address = $1", [address], (err, result) => {
                if(err){
                    this.logerror("Lookup for list "+ address + " failed. " + err)
                    resolve(false);
                }
                resolve(result.rowCount > 0);
            })
        }else{
            resolve(false)
        }
    })
}

exports.lookup = function(client, address, callback){
    this.lookup_async(client, address).then(ret => callback(ret));
}
