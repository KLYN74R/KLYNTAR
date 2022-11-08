import {LOG,SYMBIOTE_ALIAS,COLORS,BLAKE3} from "../../KLY_Utils/utils.js"

import BLS from '../../KLY_Utils/signatures/multisig/bls.js'

import cryptoModule from 'crypto'

import readline from 'readline'

import fetch from 'node-fetch'


//Object to work with hostchain
global.HOSTCHAIN = {}




export let




/**# Event initiator account
* 
* Symbiote level data.Used when we check blocks
* Here we read from cache or get data about event initiator from state,push to cache and return
*/
GET_ACCOUNT_ON_SYMBIOTE = async addrID =>{

    //We get from db only first time-the other attempts will be gotten from ACCOUNTS

    return SYMBIOTE_META.STATE_CACHE.get(addrID)||SYMBIOTE_META.STATE.get(addrID)
    
    .then(account=>{
 
        if(account.type==='account') SYMBIOTE_META.STATE_CACHE.set(addrID,account)

        return SYMBIOTE_META.STATE_CACHE.get(addrID)
 
    
    }).catch(_=>false)
 
},




GET_FROM_STATE = async recordID => {

    //We get from db only first time-the other attempts will be gotten from ACCOUNTS

    return SYMBIOTE_META.STATE_CACHE.get(recordID)||SYMBIOTE_META.STATE.get(recordID)
    
    .then(something=>{
 
        SYMBIOTE_META.STATE_CACHE.set(recordID,something)

        return SYMBIOTE_META.STATE_CACHE.get(recordID)
 
    
    }).catch(_=>false)

},



GET_FROM_STATE_FOR_QUORUM_THREAD = async recordID => {

    return SYMBIOTE_META.QUORUM_THREAD_CACHE.get(recordID)||SYMBIOTE_META.QUORUM_THREAD_METADATA.get(recordID)
    
    .then(something=>{
 
        SYMBIOTE_META.QUORUM_THREAD_CACHE.set(recordID,something)

        return SYMBIOTE_META.QUORUM_THREAD_CACHE.get(recordID)
 
    
    }).catch(_=>false)

},



WRAP_RESPONSE=(a,ttl)=>a.writeHeader('Access-Control-Allow-Origin','*').writeHeader('Cache-Control','max-age='+ttl),




GET_STUFF = async stuffID => SYMBIOTE_META.STUFF_CACHE.get(stuffID) || SYMBIOTE_META.STUFF.get(stuffID).then(obj=>{

    if(CONFIG.SYMBIOTE.STUFF_CACHE_SIZE>SYMBIOTE_META.STUFF_CACHE.size) SYMBIOTE_META.STUFF_CACHE.set(stuffID,obj)

    return obj

}).catch(async _ =>{

    LOG(`Can't find stuff with ID=\x1b[32;1m${stuffID}\x1b[36;1m in cache. Going to ask \x1b[32;1mGET_STUFF_URL\x1b[36;1m node`,'I')

    let stuff = await fetch(CONFIG.SYMBIOTE.GET_STUFF_URL+`/stuff/${stuffID}/${cache_type}`).then(r=>r.json()).catch(_=>false)

    if(stuff){


        SYMBIOTE_META.STUFF.put(stuffID,stuff).catch(_=>LOG(`Can't store stuff ${stuffID} to local storage`,'W'))

    
        if(CONFIG.SYMBIOTE.STUFF_CACHE_SIZE>SYMBIOTE_META.STUFF_CACHE.size) SYMBIOTE_META.STUFF_CACHE.set(stuffID,stuff)


    }else{

        LOG(`Can't find stuff with ID=\x1b[36;1m${stuffID}\x1b[0m in cache. Going to ask the network`,'I')

        //Combine all nodes we know about and try to find block there
        let allVisibleNodes = GET_ALL_KNOWN_PEERS()

        for(let url of allVisibleNodes){

            let answer = await fetch(url+'/stuff')

        }

    }

}),




GET_NODES=region=>{

    let nodes=CONFIG.SYMBIOTE.NODES[region]//define "IN SCOPE"(due to region and symbiote)
    
    //Default Phisher_Yeits algorithm
    
    if(nodes){
            
        let shuffled = nodes.slice(0),
            
            arrSize = nodes.length,
            
            min = arrSize - CONFIG.SYMBIOTE.NODES_PORTION, temp, index
    
    
        while (arrSize-- > min) {
    
            index = Math.floor((arrSize + 1) * Math.random())
            
            //DestructURLsation doesn't work,so use temporary variable
            temp = shuffled[index]
            
            shuffled[index] = shuffled[arrSize]
            
            shuffled[arrSize] = temp
    
        }
        
        return shuffled.slice(min)
        
    }else return []
        
},




QUICK_SORT = array => {
    
    if (array.length < 2) return array
    
    let min = 1,
        
        max = array.length - 1,
        
        rand = Math.floor(min + Math.random() * (max + 1 - min)),
        
        pivot = array[rand],

        left = [], right = []
    

    array.splice(array.indexOf(pivot),1)
    
    array = [pivot].concat(array)
    

    for (let i = 1; i < array.length; i++) pivot > array[i] ? left.push(array[i]):right.push(array[i])


    return QUICK_SORT(left).concat(pivot,QUICK_SORT(right))
  
},




//We get the quorum based on validators' metadata(pass via parameter)

GET_QUORUM = threadID => {

    let validatorsMetadata = threadID==='VERIFICATION_THREAD' ? SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA : SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.PAYLOAD.VALIDATORS_METADATA
    
        validators = Object.keys(validatorsMetadata),
    
        workflowOptions = SYMBIOTE_META[threadID].WORKFLOW_OPTIONS


    //If more than QUORUM_SIZE validators - then choose quorum. Otherwise - return full array of validators
    if(validators.length<workflowOptions.QUORUM_SIZE){

        let validatorsMetadataHash = BLAKE3(JSON.stringify(validatorsMetadata)),

            mapping = new Map(),

            sortedChallenges = QUICK_SORT(

                validators.map(
                
                    validatorPubKey => {

                        let challenge = parseInt(BLAKE3(validatorPubKey+validatorsMetadataHash),16)

                        mapping.set(challenge,validatorPubKey)

                        return challenge

                    }
                    
                )

            )

        return sortedChallenges.slice(0,workflowOptions.QUORUM_SIZE+1).map(challenge=>mapping.get(challenge))


    } else return validators


},




//Function just for pretty output about information on symbiote
BLOCKLOG=(msg,type,hash,spaces,color,block)=>{

    if(CONFIG.SYMBIOTE.LOGS.BLOCK){

        console.log(' '.repeat(spaces),color,'_'.repeat(79))

        console.log(' '.repeat(spaces),'│\x1b[33m  SYMBIOTE:\x1b[36;1m',SYMBIOTE_ALIAS(),COLORS.C,' '.repeat(1)+`${color}│`)

        let verbose='Height:'+block.index+` \x1b[33m#${color} Events:`+block.events.length+` \x1b[33m#${color} Creator:`+block.creator+` \x1b[33m#${color} Time:`+new Date(block.time).toUTCString()
            
        console.log(COLORS.T,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]`,COLORS[type],msg,COLORS.C,' '.repeat(76),`${color}│ ${verbose}`)
    
        console.log(' '.repeat(spaces),'│\x1b[33m  HASH:\x1b[36;1m',hash,COLORS.C,' '.repeat(4),`${color}│`)

        console.log(' '.repeat(spaces),' ‾'+'‾'.repeat(78),COLORS.C)
    
    }

},


SIG=data=>BLS.singleSig(data,PRIVATE_KEY),



VERIFY=(data,signature,validatorPubKey)=>BLS.singleVerify(data,validatorPubKey,signature),



/**
 * 
 * 
 * 
 * __________________________________________________________'PEERS'_________________________________________________________
 *
 * 
 *
 * PEERS contains addresses which tracked the same symbiotes or at least one symbiote from your list of symbiotes
 * We need PEERS just to exchange with blocks(at least in current pre-alpha release)
 * Non static list which changes permanently and received each time we run node
 * 
 * Also,some auths methods will be added
 * 
 * 
 * 
 * This is static list which you set to be sure that you'll receive data
 * It might be your another node,nodes of some organizations or sites,node of some pool or your friends' nodes etc.
 * 
 * 
 * 
 *  _______________________________________________________'MUST_SEND'_______________________________________________________
 * 
 * There is no "online" property coz it's implies that big_providers like crypto exchanges,famous explorers,etc.
 * have high percentage of uptime or highload tolerant infrastructure thus available 365/24/7(best case)
 * 
 * BTW we don't need them-otherwise,it's rather optimization for PANOPTICON protocol(in future) or for quick work of explorers,API,etc. and these providers will be "grateful"
 * to receive new blocks as fast as possible.That's why they receive blocks from network and accept incoming requests on their API
 * from different devices from PANOPTICON "army" of nodes
 * 
 * It doesn't imply "centralization".Ordianry nodes also can have own API(to analyze block content and give instant response) 
 * for own demands or to provide public available data
 * 
 * It's just for better efficiency
 * 
 */
 BROADCAST=(route,data)=>{

    let promises=[]


    //First of all-send to important destination points - it might be lightweight retranslators, CDNs and so on
    Object.keys(CONFIG.SYMBIOTE.MUST_SEND).forEach(addr=>
        
        promises.push(
            
            //First of all-sig data and pass signature through the next promise
            SIG(JSON.stringify(data)).then(sig=>

                fetch(CONFIG.SYMBIOTE.MUST_SEND[addr]+route,{
                
                    method:'POST',
                    
                    body:JSON.stringify({data,sig})
                
                }).catch(_=>
                    
                    CONFIG.SYMBIOTE.LOGS.OFFLINE
                    &&
                    LOG(`Offline \x1b[36;1m${addr}\u001b[38;5;3m [From:\x1b[36;1mMUST_SEND\u001b[38;5;3m]`,'W')
                    
                )

            )
            
        )

    )

    
    CONFIG.SYMBIOTE.BOOTSTRAP_NODES.forEach(addr=>
    
        fetch(addr+route,{method:'POST',body:JSON.stringify(data)})
        
        .catch(_=>
            
            CONFIG.SYMBIOTE.LOGS.OFFLINE
            &&
            LOG(`\x1b[36;1m${addr}\u001b[38;5;3m is offline [From:\x1b[36;1mBOOTSTRAP_NODES\u001b[38;5;3m]`,'W')
            
        )

    )

    /*
    
    Finally-send resource to PEERS nodes
    If response isn't equal 1-delete node from list,
    coz it's signal that node does no more support this
    symbiote(or at current time),has wrong payload size settings etc,so no sense to spend network resources on this node
    
    */


    SYMBIOTE_META.PEERS.forEach((addr,index)=>
        
        promises.push(
            
            fetch(addr+route,{method:'POST',body:JSON.stringify(data)}).then(v=>v.text()).then(value=>
                
                value!=='OK'&&SYMBIOTE_META.PEERS.splice(index,1)
                    
            ).catch(_=>{
                
                CONFIG.SYMBIOTE.LOGS.OFFLINE
                &&
                LOG(`Node \x1b[36;1m${addr}\u001b[38;5;3m seems like offline,I'll \x1b[31;1mdelete\u001b[38;5;3m it [From:\x1b[36;1mPEERS ${SYMBIOTE_ALIAS()}\x1b[33;1m]`,'W')

                SYMBIOTE_META.PEERS.splice(index,1)

            })
            
        )

    )

    return promises

},




GET_ALL_KNOWN_PEERS=()=>[...CONFIG.SYMBIOTE.BOOTSTRAP_NODES,...SYMBIOTE_META.PEERS],




DECRYPT_KEYS=async spinner=>{

    
    if(CONFIG.PRELUDE.DECRYPTED){

        spinner?.stop()
        
        // Keys is object {kly:<DECRYPTED KLYNTAR PRIVKEY>,eth:<DECRYPTED ETH PRIVKEY>,...(other privkeys in form <<< ticker:privateKey >>>)}
        let keys=JSON.parse(fs.readFileSync(CONFIG.DECRYPTED_KEYS_PATH))//use full path
        
        let ticker=CONFIG.SYMBIOTE.CONNECTOR.TICKER 

        //Main key
        global.PRIVATE_KEY=keys.kly


        if(CONFIG.EVM.includes(ticker)) HOSTCHAIN.CONNECTOR.get(ticker).PRV=Buffer.from(keys[ticker],'hex')
    
        else CONFIG.SYMBIOTE.CONNECTOR[ticker].PRV=keys[ticker]
        

        return
      
    }

    //Stop loading
    spinner?.stop()

    let symbioteConfigReference=CONFIG.SYMBIOTE,
    
        rl = readline.createInterface({input: process.stdin,output: process.stdout,terminal:false})


    LOG(`Working on \x1b[31;1m${SYMBIOTE_ALIAS()}\x1b[32;1m (\x1b[36;1m${symbioteConfigReference.MANIFEST.WORKFLOW}(major version:${SYMBIOTE_META.VERSION}) / ${symbioteConfigReference.PUB}\x1b[32;1m)`,'I')
       


    
    let HEX_SEED=await new Promise(resolve=>
        
        rl.question(`\n ${COLORS.T}[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})${COLORS.C}  Enter \x1b[32mpassword\x1b[0m to decrypt private key on \x1b[36;1m${SYMBIOTE_ALIAS()}\x1b[0m in memory of process ———> \x1b[31m`,resolve)
        
    )
        

    //Get 32 bytes SHA256(Password)
    HEX_SEED=cryptoModule.createHash('sha256').update(HEX_SEED,'utf-8').digest('hex')

    let IV=Buffer.from(HEX_SEED.slice(32),'hex')//Get second 16 bytes for initialization vector


    console.log('\x1b[0m')

    HEX_SEED=HEX_SEED.slice(0,32)//Retrieve first 16 bytes from hash



    //__________________________________________DECRYPT MAIN PRIVATE KEY____________________________________________

    

    let decipher = cryptoModule.createDecipheriv('aes-256-cbc',HEX_SEED,IV)
    
    global.PRIVATE_KEY=decipher.update(symbioteConfigReference.PRV,'hex','utf8')+decipher.final('utf8')



    //_____________________________________DECRYPT PRIVATE KEYS FOR HOSTCHAIN_______________________________________


    let decipherHostchain = cryptoModule.createDecipheriv('aes-256-cbc',HEX_SEED,IV),
    
        privateKey=decipherHostchain.update(symbioteConfigReference.CONNECTOR.PRV,'hex','utf8')+decipherHostchain.final('utf8')

        
    if(CONFIG.EVM.includes(CONFIG.SYMBIOTE.CONNECTOR.TICKER)) symbioteConfigReference.CONNECTOR.PRV=Buffer.from(privateKey,'hex')
        
    else symbioteConfigReference.CONNECTOR.PRV=privateKey
        
    LOG(`Hostchain [\x1b[36;1m${CONFIG.SYMBIOTE.CONNECTOR.TICKER}\x1b[32;1m] ~~~> private key was decrypted successfully`,'S')

    
    rl.close()

}