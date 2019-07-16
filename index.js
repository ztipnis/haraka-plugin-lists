'use strict';
const constants = require('haraka-constants');
const List = require("./list");

exports.register = function () {
    const plugin = this;
    plugin.load_lists_ini();
    if(plugin.cfg.main.enabled === true){
        plugin.loginfo("Plugin Lists Enabled",null)
        plugin.register_hook('init_master','init_pool');
        plugin.register_hook('connect_init', 'init_client');
        plugin.register_hook('rcpt', 'validate_list_addresses');
        plugin.register_hook('queue', 'queue_list');
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
    if(!(typeof plugin.db_pool_postgres !== 'undefined' && plugin.db_pool_postgres)){
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

exports.validate_list_addresses = function(next, connection, params){
    const plugin = this;
    const util = require('util');
    var recipient = params[0].user + "@" + params[0].host;
    connection.logdebug("Checking for list named " + util.inspect(recipient))
    var lst = new List(recipient);
    lst.validate(connection.notes.pgresClient).then((valid) =>{
        if(valid){
            connection.logdebug("List named: '" + recipient +"' exists!")
            connection.notes.islist = true;
            return next(constants.OK);
        }else{
            connection.logdebug("List does not exist");
            connection.notes.islist = false;
            return next(constants.CONT);
        }
    }).catch((err) =>{
        plugin.logerror(err.message);
        return next(constants.CONT);
    })
}

exports.hook_data = function(next, connection){
    connection.transaction.parse_body = true;
    next();
}


exports.queue_list = function (next,connection) {
    try{
        const plugin = this;
        var Address = require('address-rfc2821').Address;
        if(connection.notes.islist){
            const recipients = connection.transaction.rcpt_to;
            connection.transaction.rcpt_to = [];
            var rcpt_ret = recipients.map(async (recipient) => {
                let lst = new List(recipient.user + "@" + recipient.host)
                try{
                    var islist = await lst.validate(connection.notes.pgresClient)
                    if(islist){
                        var listUsers = await lst.recipients(connection.notes.pgresClient)
                        return listUsers.map((listUserEmail) => new Address(listUserEmail))
                    }else{
                        connection.transaction.rcpt_to.push(recipient)
                        return [];
                    }
                }catch(err){
                    plugin.logerror("Database Connection Failed " + err.message)
                    throw next(constants.DENYSOFT);
                }
            }, this)
            Promise.all(rcpt_ret).then(async (rcpt_to) => {
                let list_queue = rcpt_to.flat();
                if(await plugin.queue_outbound(connection, list_queue)){
                    plugin.logdebug("Remaining Addresses: " + JSON.stringify(connection.transaction.rcpt_to));
                    next(constants.CONT);
                }else{
                    next(constants.DENYSOFT);
                }
            })
        }
    }catch (err){
        plugin.logerror("A message was temporarily denied because we were unable to connect to Postgres. Please fix the error, or any list email will be indefinitely denied: \n" + err.message)
    }
}


exports.close_client = function(next, connection){
    if(typeof connection.notes.pgresClient !== 'undefined' && connection.notes.pgresClient){
        connection.notes.pgresClient.release()
    }
    next();
}


exports.queue_outbound = async function(connection, users){
    const plugin = this;
    const outbound = plugin.haraka_require('outbound');
    const from = connection.transaction.mail_from
    var trans = Object.assign({}, connection.transaction);
    return await new Promise((rslv) => {
        trans.message_stream.get_data((contents) => {
            contents = contents.toString().replace(/\r/g, '');
            //got contents
            let sent = users.map((address) =>{
                //for each recipient send email
                const to = address.toString();
                plugin.logdebug("sending email to: " + to)
                return new Promise((resolve) => {
                    outbound.send_email(from, to, contents, (code, msg) => {
                        switch(code){
                            case DENY: plugin.logerror("Sending mail failed: " + msg);
                                       resolve(false);
                                       break;
                            case OK:   plugin.loginfo("List email sent")
                                       resolve(true);
                                       break;
                            default:   plugin.logerror("Unrecognized return code from sending email: " + msg);
                                       resolve(false);
                                       break;
                        }
                    });
                })
            })
            
            if(sent.every((ret) => ret)){
                rslv(true)
            }else{

                rslv(false)
            }
        })
    })
}


