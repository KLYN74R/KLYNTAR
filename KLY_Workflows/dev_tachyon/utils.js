import {LOG,COLORS,BLAKE3,GET_GMT_TIMESTAMP,ED25519_SIGN_DATA} from '../../KLY_Utils/utils.js'

import BLS from '../../KLY_Utils/signatures/multisig/bls.js'

import cryptoModule from 'crypto'

import readline from 'readline'

import fetch from 'node-fetch'

import https from 'https'

import http from 'http'

import fs from 'fs'








export let




/**# Event initiator account
* 
* Symbiote level data.Used when we check blocks
* Here we read from cache or get data about tx initiator from state,push to cache and return
*/
GET_ACCOUNT_ON_SYMBIOTE = async identificationHash =>{

    //We get from db only first time-the other attempts will be gotten from ACCOUNTS

    return global.SYMBIOTE_META.STATE_CACHE.get(identificationHash)||global.SYMBIOTE_META.STATE.get(identificationHash)
    
    .then(account=>{
 
        if(account.type==='account') global.SYMBIOTE_META.STATE_CACHE.set(identificationHash,account)

        return global.SYMBIOTE_META.STATE_CACHE.get(identificationHash)
 
    
    }).catch(()=>false)
 
},




GET_FROM_STATE = async recordID => {

    //We get from db only first time-the other attempts will be gotten from ACCOUNTS

    return global.SYMBIOTE_META.STATE_CACHE.get(recordID)||global.SYMBIOTE_META.STATE.get(recordID)
    
    .then(something=>{
 
        global.SYMBIOTE_META.STATE_CACHE.set(recordID,something)

        return global.SYMBIOTE_META.STATE_CACHE.get(recordID)
 
    
    }).catch(()=>false)

},




GET_FROM_QUORUM_THREAD_STATE = async recordID => {

    return global.SYMBIOTE_META.QUORUM_THREAD_CACHE.get(recordID)||global.SYMBIOTE_META.QUORUM_THREAD_METADATA.get(recordID)
    
    .then(something=>{
 
        global.SYMBIOTE_META.QUORUM_THREAD_CACHE.set(recordID,something)

        return global.SYMBIOTE_META.QUORUM_THREAD_CACHE.get(recordID)
 
    
    }).catch(()=>false)

},




WRAP_RESPONSE=(a,ttl)=>a.writeHeader('Access-Control-Allow-Origin','*').writeHeader('Cache-Control','max-age='+ttl),




GET_NODES=region=>{

    let nodes=global.CONFIG.SYMBIOTE.NODES[region]//define "IN SCOPE"(due to region and symbiote)
    
    //Default Phisher_Yeits algorithm
    
    if(nodes){
            
        let shuffled = nodes.slice(0),
            
            arrSize = nodes.length,
            
            min = arrSize - global.CONFIG.SYMBIOTE.NODES_PORTION, temp, index
    
    
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


swap = (arr, firstItemIndex, lastItemIndex) => {
    
    let temp = arr[firstItemIndex]
  
    // Swap first and last items in the array

    arr[firstItemIndex] = arr[lastItemIndex]
    
    arr[lastItemIndex] = temp
  
},
  



heapify = (heap, i, max) => {
    
    let index
    
    let leftChild
    
    let rightChild
  


    while (i < max) {
      
        index = i
  
        // Get the left child index 
        // Using the known formula
        leftChild = 2 * i + 1
      
        // Get the right child index 
        // Using the known formula
        rightChild = leftChild + 1
  
        // If the left child is not last element 
        // And its value is bigger
        if (leftChild < max && heap[leftChild] > heap[index]) {
        
            index = leftChild
        
        }
  
        // If the right child is not last element 
        // And its value is bigger
        if (rightChild < max && heap[rightChild] > heap[index]) {
        
            index = rightChild
        
        }
  
        // If none of the above conditions is true
        // Just return
        if (index === i) return

  
        // Else swap elements
        swap(heap, i, index)
 
        // Continue by using the swapped index
        i = index
    
    }
  
},




buildMaxHeap = array => {

    // Get index of the middle element
    let i = Math.floor(array.length / 2 - 1)
  
    // Build a max heap out of
    // All array elements passed in
    while (i >= 0) {
    
        heapify(array, i, array.length)

        i -= 1;
    
    }
  
},




HEAP_SORT = arr => {

    // Build max heap
    buildMaxHeap(arr)
  
    // Get the index of the last element
    let lastElement = arr.length - 1
  
    // Continue heap sorting until we have
    // One element left
    while (lastElement > 0) {

        swap(arr, 0, lastElement)
      
        heapify(arr, 0, lastElement)
        
        lastElement -= 1
    
    }
    
    // Return sorted array
    return arr

},




//We get the quorum based on pools' metadata(pass via parameter)

GET_QUORUM = (poolsRegistry,workflowOptions,newEpochSeed) => {

    let pools = poolsRegistry.primePools.concat(poolsRegistry.reservePools)

    //If more than QUORUM_SIZE pools - then choose quorum. Otherwise - return full array of pools
    if(pools.length > workflowOptions.QUORUM_SIZE){

        let poolsMetadataHash = BLAKE3(JSON.stringify(poolsRegistry)+newEpochSeed),

            mapping = new Map(),

            sortedChallenges = HEAP_SORT(

                pools.map(
                
                    validatorPubKey => {

                        let challenge = parseInt(BLAKE3(validatorPubKey+poolsMetadataHash),16)

                        mapping.set(challenge,validatorPubKey)

                        return challenge

                    }
                    
                )

            )

        return sortedChallenges.slice(0,workflowOptions.QUORUM_SIZE).map(challenge=>mapping.get(challenge))


    } else return pools


},




//Function just for pretty output about information on symbiote
BLOCKLOG=(msg,hash,block,checkpointIndex)=>{

    if(global.CONFIG.DAEMON_LOGS){

        let preColor = msg.includes('accepted') ? '\x1b[31m' : '\x1b[32m'

        console.log(COLORS.T,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS.I,msg,COLORS.C)

        console.log('\n')
        
        console.log(` ${preColor}│\x1b[33m  ID:\x1b[36;1m`,checkpointIndex+':'+block.creator+':'+block.index,COLORS.C)

        console.log(` ${preColor}│\x1b[33m  Hash:\x1b[36;1m`,hash,COLORS.C)

        console.log(` ${preColor}│\x1b[33m  Txs:\x1b[36;1m`,block.transactions.length,COLORS.C)

        console.log(` ${preColor}│\x1b[33m  Time:\x1b[36;1m`,new Date(block.time).toString(),COLORS.C)
    
        console.log('\n')

    }

},


BLS_SIGN_DATA=data=>BLS.singleSig(data,global.PRIVATE_KEY),


BLS_VERIFY=async(data,signature,validatorPubKey)=>BLS.singleVerify(data,validatorPubKey,signature),


GET_HTTP_AGENT=host=>host.startsWith('https') ? new https.Agent({keepAlive:true}) : new http.Agent({keepAlive:true}),


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
 BROADCAST=async(route,data)=>{

    let promises=[]

    let quorumMembers = await GET_QUORUM_URLS_AND_PUBKEYS()

    quorumMembers.forEach(host=>
    
        fetch(host+route,{method:'POST',body:JSON.stringify(data),agent:GET_HTTP_AGENT(host)}).catch(()=>{})
        
    )

    
    //First of all-send to important destination points - it might be lightweight retranslators, CDNs and so on
    Object.keys(global.CONFIG.SYMBIOTE.MUST_SEND).forEach(addr=>
        
        promises.push(
            
            //First of all-sig data and pass signature through the next promise
            ED25519_SIGN_DATA(JSON.stringify(data),global.CONFIG.SYMBIOTE.PRV).then(sig=>

                fetch(global.CONFIG.SYMBIOTE.MUST_SEND[addr]+route,{
                
                    method:'POST',
                    
                    body:JSON.stringify({data,sig}),

                    agent:GET_HTTP_AGENT(global.CONFIG.SYMBIOTE.MUST_SEND[addr])
                
                }).catch(()=>
                    
                    LOG(`Offline \x1b[36;1m${addr}\u001b[38;5;3m [From:\x1b[36;1mMUST_SEND\u001b[38;5;3m]`,'W')
                    
                )

            )
            
        )

    )

    
    global.CONFIG.SYMBIOTE.BOOTSTRAP_NODES.forEach(host=>
    
        fetch(host+route,{method:'POST',body:JSON.stringify(data),agent:GET_HTTP_AGENT(host)})
        
        .catch(()=>
            
            LOG(`\x1b[36;1m${host}\u001b[38;5;3m is offline [From:\x1b[36;1mBOOTSTRAP_NODES\u001b[38;5;3m]`,'W')
            
        )

    )

    /*
    
    Finally-send resource to PEERS nodes
    If response isn't equal 1-delete node from list,
    coz it's signal that node does no more support this
    symbiote(or at current time),has wrong payload size settings etc,so no sense to spend network resources on this node
    
    */


    global.SYMBIOTE_META.PEERS.forEach((host,index)=>
        
        promises.push(
            
            fetch(host+route,{method:'POST',body:JSON.stringify(data),agent:GET_HTTP_AGENT(host)}).then(v=>v.text()).then(value=>
                
                value!=='OK' && global.SYMBIOTE_META.PEERS.splice(index,1)
                    
            ).catch(()=>{
                
                LOG(`Node \x1b[36;1m${host}\u001b[38;5;3m seems like offline,I'll \x1b[31;1mdelete\u001b[38;5;3m it`,'W')

                global.SYMBIOTE_META.PEERS.splice(index,1)

            })
            
        )

    )

    return promises

},




GET_ALL_KNOWN_PEERS=()=>[...global.CONFIG.SYMBIOTE.BOOTSTRAP_NODES,...global.SYMBIOTE_META.PEERS],




GET_QUORUM_URLS_AND_PUBKEYS = async (withPubkey,checkpoint) => {

    let toReturn = []

    checkpoint ||= global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    for(let pubKey of checkpoint.quorum){

        let poolStorage = global.SYMBIOTE_META.QUORUM_THREAD_CACHE.get(pubKey+'(POOL)_STORAGE_POOL') || await GET_FROM_QUORUM_THREAD_STATE(pubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        if(poolStorage){

            toReturn.push(withPubkey ? {url:poolStorage.poolURL,pubKey} : poolStorage.poolURL)
        
        }

    }

    return toReturn

},




//global.SYMBIOTE_META.VERSION shows the real software version of appropriate workflow
//We use this function on VERIFICATION_THREAD and QUORUM_THREAD to make sure we can continue to work
//If major version was changed and we still has an old version - we should stop node and update software
IS_MY_VERSION_OLD = threadID => global.SYMBIOTE_META[threadID].VERSION > global.SYMBIOTE_META.VERSION,




CHECK_IF_CHECKPOINT_STILL_FRESH = thread => {

    let checkpointTime = thread.CHECKPOINT.timestamp

    let currentTime = GET_GMT_TIMESTAMP()

    return checkpointTime + thread.WORKFLOW_OPTIONS.EPOCH_TIME > currentTime

},




GET_MAJORITY = checkpoint => {

    let quorumNumber = checkpoint.quorum.length

    let majority = Math.floor(quorumNumber*(2/3))+1


    //Check if majority is not bigger than number of pools. It's possible when there is a small number of pools

    return majority > quorumNumber ? quorumNumber : majority

},




USE_TEMPORARY_DB=async(operationType,dbReference,keys,values)=>{


    if(operationType === 'get'){

        let value = await dbReference.get(keys)

        return value

    }
    else if(operationType === 'put') await dbReference.put(keys,values)

    else if(operationType === 'atomicPut'){

        let atomicBatch = dbReference.batch()

        for(let i=0,len=keys.length;i<len;i++) atomicBatch.put(keys[i],values[i])

        await atomicBatch.write()
        

    }

    else await dbReference.del(keys)

},




DECRYPT_KEYS=async spinner=>{

    
    if(global.CONFIG.PRELUDE.DECRYPTED){

        spinner?.stop()
        
        // Keys is object {kly:<DECRYPTED KLYNTAR PRIVKEY>,eth:<DECRYPTED ETH PRIVKEY>,...(other privkeys in form <<< ticker:privateKey >>>)}
        let keys=JSON.parse(fs.readFileSync(global.CONFIG.DECRYPTED_KEYS_PATH))//use full path

        //Main key
        global.PRIVATE_KEY=keys.kly


        return
      
    }

    //Stop loading
    spinner?.stop()

    let symbioteConfigReference=global.CONFIG.SYMBIOTE
    
    let rl = readline.createInterface({input: process.stdin,output: process.stdout,terminal:false})


    LOG(`Local VERIFICATION_THREAD state is \x1b[32;1m${global.SYMBIOTE_META.VERIFICATION_THREAD.FINALIZATION_POINTER.currentAuthority} \u001b[38;5;168m}———{\x1b[32;1m ${global.SYMBIOTE_META.VERIFICATION_THREAD.FINALIZATION_POINTER.index} \u001b[38;5;168m}———{\x1b[32;1m ${global.SYMBIOTE_META.VERIFICATION_THREAD.FINALIZATION_POINTER.hash}\n`,'I')

    LOG(`Symbiote stats \x1b[32;1m(\x1b[36;1mworkflow:${global.GENESIS.WORKFLOW}[QT major version:${global.SYMBIOTE_META.VERSION}] / id:${symbioteConfigReference.PUB}\x1b[32;1m)`,'I')
       


    
    let hexSeed=await new Promise(resolve=>
        
        rl.question(`\n ${COLORS.T}[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})${COLORS.C}  Enter \x1b[32mpassword\x1b[0m to decrypt private key in memory of process ———> \x1b[31m`,resolve)
        
    )
        

    //Get 32 bytes SHA256(Password)
    hexSeed=cryptoModule.createHash('sha256').update(hexSeed,'utf-8').digest('hex')

    let IV=Buffer.from(hexSeed.slice(32),'hex')//Get second 16 bytes for initialization vector


    console.log('\x1b[0m')

    hexSeed=hexSeed.slice(0,32)//Retrieve first 16 bytes from hash



    //__________________________________________DECRYPT PRIVATE KEY____________________________________________


    let decipher = cryptoModule.createDecipheriv('aes-256-cbc',hexSeed,IV)
    
    global.PRIVATE_KEY=decipher.update(symbioteConfigReference.PRV,'hex','utf8')+decipher.final('utf8')

    
    rl.close()

}