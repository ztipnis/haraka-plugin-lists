module.exports = function (address){
	this.address = address;
	this.validate = async (client) => {
		if(client){
			try{
				let result = await client.query("SELECT * FROM \"public\".\"lists\" WHERE address = $1", [address])
				return result.rowCount > 0;
			}catch(err){
				throw new Error("Lookup for list "+ address + " failed. " + err)
			}
            
        }else{
            throw new Error("Client does not exist")
        }
	}
	this.recipients = async (client) => {
		if(client){
			try{
				let result = await client.query("SELECT A.email FROM \"public\".\"lists\" AS l RIGHT JOIN \"public\".\"listUsers\" AS A ON A.lid=l.id WHERE l.address=$1", [address])
				return result.rows.map((rw) => rw.email);
			}catch(err){
				throw new Error("Lookup recipients for list "+ address + " failed. " + err)
			}
            
        }else{
            throw new Error("Client does not exist")
        }
    }

    this.verp = function(command){
    	let regex = /([\w\d]+)@([\w\d]+\.\w+)/
    	switch(command){
    		case "sub":
    			return address.replace(regex, "$1%sub%@$2")
    		case "unsub":
    			return address.replace(regex, "$1%unsub%$2")
    		default:
    			return address;
    	}
    }
    this.unverp = function(){
    	let regex = /([\w\d]+)(%[\w]+%)*@([\w\d]+\.\w+)/
    	return address.replace(regex, "$1@$3")
    }


}