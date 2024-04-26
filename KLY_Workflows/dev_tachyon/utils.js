import {BLOCKCHAIN_DATABASES, BLOCKCHAIN_METADATA, GLOBAL_CACHES, WORKING_THREADS} from './blockchain_preparation.js'

import {LOG, COLORS, BLAKE3, GET_UTC_TIMESTAMP, ED25519_VERIFY} from '../../KLY_Utils/utils.js'

import {BLOCKCHAIN_GENESIS, CONFIGURATION} from '../../klyn74r.js'

import Block from './essences/block.js'

import cryptoModule from 'crypto'

import readline from 'readline'

import fetch from 'node-fetch'










export let




/**# Event initiator account
* 
* Symbiote level data.Used when we check blocks
* Here we read from cache or get data about tx initiator from state,push to cache and return
*/
GET_ACCOUNT_ON_SYMBIOTE = async identificationHash =>{

    //We get from db only first time-the other attempts will be gotten from ACCOUNTS

    return GLOBAL_CACHES.STATE_CACHE.get(identificationHash) || BLOCKCHAIN_DATABASES.STATE.get(identificationHash)
    
    .then(account=>{
 
        if(account.type==='account') GLOBAL_CACHES.STATE_CACHE.set(identificationHash,account)

        return GLOBAL_CACHES.STATE_CACHE.get(identificationHash)
 
    
    }).catch(()=>false)
 
},




VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF = async (itsProbablyAggregatedEpochFinalizationProof,quorum,majority,epochFullID) => {

    let overviewIsOK =
        
        typeof itsProbablyAggregatedEpochFinalizationProof === 'object'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.shard === 'string'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.lastLeader === 'number'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.lastIndex === 'number'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.lastHash === 'string'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.hashOfFirstBlockByLastLeader === 'string'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.proofs === 'object'

    if(overviewIsOK && itsProbablyAggregatedEpochFinalizationProof){

        /*
    
            The structure of AGGREGATED_EPOCH_FINALIZATION_PROOF is

            {
                shard:<ed25519 pubkey of prime pool - creator of shard>,
                lastLeader:<index of Ed25519 pubkey of some pool in shard's reassignment chain>,
                lastIndex:<index of his block in previous epoch>,
                lastHash:<hash of this block>,
                hashOfFirstBlockByLastLeader,

                proofs:{

                    ed25519PubKey0:ed25519Signa0,
                    ...
                    ed25519PubKeyN:ed25519SignaN
                         
                }

            }

            We need to verify that majority have voted for such solution


        */

        let {shard,lastLeader,lastIndex,lastHash,hashOfFirstBlockByLastLeader} = itsProbablyAggregatedEpochFinalizationProof

        let dataThatShouldBeSigned = 'EPOCH_DONE'+shard+lastLeader+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullID

        let promises = []

        let okSignatures = 0

        let unique = new Set()


        for(let [signerPubKey,signa] of Object.entries(itsProbablyAggregatedEpochFinalizationProof.proofs)){

            promises.push(ED25519_VERIFY(dataThatShouldBeSigned,signa,signerPubKey).then(isOK => {

                if(isOK && quorum.includes(signerPubKey) && !unique.has(signerPubKey)){

                    unique.add(signerPubKey)

                    okSignatures++

                }

            }))

        }

        await Promise.all(promises)
        
        if(okSignatures>=majority){

            return {
            
                shard,lastLeader,lastIndex,lastHash,hashOfFirstBlockByLastLeader,
        
                proofs:itsProbablyAggregatedEpochFinalizationProof.proofs

            }

        }
        
    }

},




VERIFY_AGGREGATED_FINALIZATION_PROOF = async (itsProbablyAggregatedFinalizationProof,epochHandler) => {

    // Make the initial overview
    let generalAndTypeCheck =   itsProbablyAggregatedFinalizationProof
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.prevBlockHash === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.blockID === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.blockHash === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.proofs === 'object'


    if(generalAndTypeCheck){

        let epochFullID = epochHandler.hash+"#"+epochHandler.id

        let {prevBlockHash,blockID,blockHash,proofs} = itsProbablyAggregatedFinalizationProof

        let dataThatShouldBeSigned = prevBlockHash+blockID+blockHash+epochFullID

        let majority = GET_MAJORITY(epochHandler)


        let promises = []

        let okSignatures = 0

        let unique = new Set()


        for(let [signerPubKey,signa] of Object.entries(proofs)){

            promises.push(ED25519_VERIFY(dataThatShouldBeSigned,signa,signerPubKey).then(isOK => {

                if(isOK && epochHandler.quorum.includes(signerPubKey) && !unique.has(signerPubKey)){

                    unique.add(signerPubKey)

                    okSignatures++

                }

            }))

        }

        await Promise.all(promises)

        return okSignatures >= majority


    }

},




GET_PSEUDO_RANDOM_SUBSET_FROM_QUORUM_BY_TICKET_ID=(ticketID,epochHandler)=>{

    /*

        _________________DISCLAIMER_________________

        * The values of the network parameters in genesis may change before the launch or during the network operation
        ____________________________________________

        We need this function to get the minority of validators from quorum and send blocks only to them

        This is the improvement for Tachyon consensus where we need to send blocks only to 21 independent and pseudo-random validators from quorum

        Traditionally, in BFT blockchains, we assume that network is secured in case partition of stakes under control of malicious actor(s) are lower than 33%

        In KLY, we assume the security boundary is 20-21%(because of the following reasons) under control of bad guy:

            1) In case we have 1000 validators(what is normal value for top blockchains(see Solana, Avalanche, etc.)) and quorum size is 256.
            
            2) With these values, we can be sure that more than 67% of 256 validators in quorum will be honest players.
            
                The probability that >=33% of 256 will be bad actors is 1 case per 1M epoches. In case epoch is 1 day - this chance is equal to 1 case per 2739 years

            3) Now, to force shards leaders to send their blocks only to 21 validators we must accept the fact that all 21 randomly choosen validators from 256 should be fair
            
                and response with a valid signature to aggregate it and send as a proof to the rest of quorum:

                P(chance that in group of 21 all will be fair players) = C(172,21) / C(256,21) what is 0.0153 %

                P(chance that in group of 21 all will be bad actors) = C(84,21) / C(256,21) what is 1.03 * 10^-9 %

            4) Now, let each shard leader can choose random subminorities with size of 21 from quorum, saying 10 000 times

                This gives us that total chance to find a subset with 21 fair validators will be equal to 153 %,
                
                    while chance that in subset will be no at least one fair validator is equal to 1.03 * 10^-5 % - or approximately 1 case per 273 years 

            5) That's why, based on <quorum> and <ticketID>(in range 0-9999) we find the subset in quorum where the shard leader should send blocks



    */

    // If QUORUM_SIZE > 21 - do challenge, otherwise - return the whole quorum
    if(epochHandler.quorum.length > 21){

        // Based on ticket_id + epochHandler.hash as a seed value - generate 21 values in range [0;quorum.size]

        // Then, return the resulting array of 21 validators by indexes in <quorum> array

        let subsetToReturn = []

        for(let i=0 ; i < 21 ; i++) {

            let seed = BLAKE3(`${epochHandler.hash}:${ticketID}:${i}`)

            // Hex => Number
            let hashAsNumber = parseInt(seed, 16);
    
            // Normalize to [0, 1]
            let normalizedValue = hashAsNumber / (parseInt('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16) + 1);
    
            let min = 0, max = epochHandler.quorum.length-1
    
            // Normalize to [min, max]
            let scaledValue = min + Math.floor(normalizedValue * (max - min + 1))
                
            subsetToReturn.push(epochHandler.quorum[scaledValue])

        }

        return subsetToReturn


    } else return epochHandler.quorum


},




GET_VERIFIED_AGGREGATED_FINALIZATION_PROOF_BY_BLOCK_ID = async (blockID,epochHandler) => {

    let localVersionOfAfp = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+blockID).catch(()=>null)

    if(!localVersionOfAfp){

        // Go through known hosts and find AGGREGATED_FINALIZATION_PROOF. Call GET /aggregated_finalization_proof route
    
        let setOfUrls = await GET_QUORUM_URLS_AND_PUBKEYS(false,epochHandler)

        for(let endpoint of setOfUrls){

            let itsProbablyAggregatedFinalizationProof = await fetch(endpoint+'/aggregated_finalization_proof/'+blockID).then(r=>r.json()).catch(()=>null)

            if(itsProbablyAggregatedFinalizationProof){

                let isOK = await VERIFY_AGGREGATED_FINALIZATION_PROOF(itsProbablyAggregatedFinalizationProof,epochHandler)

                if(isOK){

                    let {prevBlockHash,blockID,blockHash,proofs} = itsProbablyAggregatedFinalizationProof

                    return {prevBlockHash,blockID,blockHash,proofs}

                }

            }

        }

    }else return localVersionOfAfp

},




GET_FIRST_BLOCK_ON_EPOCH = async(epochHandler,shardID,getBlockFunction) => {

    // Check if we already tried to find first block by finding pivot in cache

    let pivotShardID = `${epochHandler.id}:${shardID}`

    let pivotPoolData = GLOBAL_CACHES.STUFF_CACHE.get(pivotShardID) // {position,pivotPubKey,firstBlockByPivot,firstBlockHash}

    if(!pivotPoolData){

        let arrayOfReservePoolsForShard = epochHandler.leadersSequence[shardID]
        
        for(let position = -1, length = arrayOfReservePoolsForShard.length ; position < length ; position++){

            let potentialPivotPubKey = arrayOfReservePoolsForShard[position] || shardID

            let firstBlockIDByThisPubKey = epochHandler.id+':'+potentialPivotPubKey+':0'

            // Try to get AFP & first block to commit pivot and continue to find first block

            let afp = await GET_VERIFIED_AGGREGATED_FINALIZATION_PROOF_BY_BLOCK_ID(firstBlockIDByThisPubKey,epochHandler)

            let potentialFirstBlock = await getBlockFunction(epochHandler.id,potentialPivotPubKey,0)


            if(afp && afp.blockID === firstBlockIDByThisPubKey && potentialFirstBlock && afp.blockHash === Block.genHash(potentialFirstBlock)){

                // Once we find it - set as pivot for further actions

                let pivotTemplate = {

                    position,

                    pivotPubKey:potentialPivotPubKey,
                    
                    firstBlockByPivot:potentialFirstBlock,

                    firstBlockHash:afp.blockHash

                }

                GLOBAL_CACHES.STUFF_CACHE.set(pivotShardID,pivotTemplate)

                break

            }
        
        }

    }

    
    pivotPoolData = GLOBAL_CACHES.STUFF_CACHE.get(pivotShardID)


    if(pivotPoolData){

        // In pivot we have first block created in epoch by some pool

        // Try to move closer to the beginning of the epochHandler.leadersSequence[shardID] to find the real first block

        // Once we 

        if(pivotPoolData.position === -1){

            // Imediately return - it's signal that prime pool created the first block, so no sense to find smth more

            return {firstBlockCreator:shardID,firstBlockHash:pivotPoolData.firstBlockHash}


        }else{

            // Otherwise - continue to search

            // Based on ALRP in pivot block - find the real first block

            let blockToEnumerateAlrp = pivotPoolData.firstBlockByPivot

            let arrayOfReservePoolsForShard = epochHandler.leadersSequence[shardID]

            for(let position = pivotPoolData.position-1 ; position >= -1 ; position--){
    
                
                let previousPoolInLeadersSequence = arrayOfReservePoolsForShard[position] || shardID
    
                let leaderRotationProofForPreviousPool = blockToEnumerateAlrp.extraData.aggregatedLeadersRotationProofs[previousPoolInLeadersSequence]


                if(previousPoolInLeadersSequence === shardID){

                    // In case we're on the beginning of the leaders sequence

                    if(leaderRotationProofForPreviousPool.skipIndex === -1){

                        GLOBAL_CACHES.STUFF_CACHE.delete(pivotShardID)

                        return {firstBlockCreator:pivotPoolData.pivotPubKey,firstBlockHash:pivotPoolData.firstBlockHash}

                    }else{

                        // Clear the cache and return the result that the first block creator 

                        GLOBAL_CACHES.STUFF_CACHE.delete(pivotShardID)
                        
                        return {firstBlockCreator:shardID,firstBlockHash:leaderRotationProofForPreviousPool.firstBlockHash}

                    }


                } else if(leaderRotationProofForPreviousPool.skipIndex !== -1) {

                    // This means that we've found new pivot - so update it and break the cycle to repeat procedure later

                    let firstBlockByNewPivot = await getBlockFunction(epochHandler.id,previousPoolInLeadersSequence,0)

                    if(firstBlockByNewPivot && leaderRotationProofForPreviousPool.firstBlockHash === Block.genHash(firstBlockByNewPivot)){

                        let newPivotTemplate = {

                            position,
    
                            pivotPubKey:previousPoolInLeadersSequence,
    
                            firstBlockByPivot:firstBlockByNewPivot,
    
                            firstBlockHash:leaderRotationProofForPreviousPool.firstBlockHash
    
                        }

                        GLOBAL_CACHES.STUFF_CACHE.set(pivotShardID,newPivotTemplate)

                        return

                    } else return

                }
    
            }

        }

    }

},




GET_RANDOM_FROM_ARRAY = arr => {

    let randomIndex = Math.floor(Math.random() * arr.length)
  
    return arr[randomIndex]

},




GET_FROM_STATE = async recordID => {

    //We get from db only first time-the other attempts will be gotten from ACCOUNTS

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
    .then(something=>{
 
        GLOBAL_CACHES.STATE_CACHE.set(recordID,something)

        return GLOBAL_CACHES.STATE_CACHE.get(recordID)
 
    
    }).catch(()=>false)

},




GET_FROM_APPROVEMENT_THREAD_STATE = async recordID => {

    return GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.get(recordID)
    
    .then(something=>{
 
        GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.set(recordID,something)

        return GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(recordID)
 
    
    }).catch(()=>false)

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




//Function for pretty output the information about verification thread(VT)
VT_STATS_LOG = (epochFullID,shardContext) => {


    if(WORKING_THREADS.VERIFICATION_THREAD.VT_FINALIZATION_STATS[shardContext]){


        let {currentLeaderOnShard,index,hash} = WORKING_THREADS.VERIFICATION_THREAD.VT_FINALIZATION_STATS[shardContext]


        console.log(COLORS.TIME_COLOR,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS.CYAN,'Local VERIFICATION_THREAD state is',COLORS.CLEAR)
    
        console.log('\n')
            
        console.log(` \u001b[38;5;168m│\x1b[33m  Epoch:\x1b[36;1m`,`${epochFullID}`,COLORS.CLEAR)
    
        console.log(` \u001b[38;5;168m│\x1b[33m  SID:\x1b[36;1m`,`${shardContext}:${(WORKING_THREADS.VERIFICATION_THREAD.SID_TRACKER[shardContext]-1)}`,COLORS.CLEAR)
    
        console.log(` \u001b[38;5;168m│\x1b[33m  Current Leader:\x1b[36;1m`,currentLeaderOnShard,COLORS.CLEAR)
    
        console.log(` \u001b[38;5;168m│\x1b[33m  Block index and hash in current epoch:\x1b[36;1m`,index+' : '+hash,COLORS.CLEAR)
    
        console.log('\n')    

    }

},




//Function just for pretty output about information on symbiote
BLOCKLOG=(msg,hash,block,epochIndex)=>{


    if(CONFIGURATION.NODE_LEVEL.DAEMON_LOGS){

        let preColor = msg.includes('accepted') ? '\x1b[31m' : '\x1b[32m'

        console.log(COLORS.TIME_COLOR,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,COLORS.CYAN,msg,COLORS.CLEAR)

        console.log('\n')
        
        console.log(` ${preColor}│\x1b[33m  ID:\x1b[36;1m`,epochIndex+':'+block.creator+':'+block.index,COLORS.CLEAR)

        console.log(` ${preColor}│\x1b[33m  Hash:\x1b[36;1m`,hash,COLORS.CLEAR)

        console.log(` ${preColor}│\x1b[33m  Txs:\x1b[36;1m`,block.transactions.length,COLORS.CLEAR)

        console.log(` ${preColor}│\x1b[33m  Time:\x1b[36;1m`,new Date(block.time).toString(),COLORS.CLEAR)
    
        console.log('\n')

    }

},




GET_ALL_KNOWN_PEERS=()=>[...CONFIGURATION.NODE_LEVEL.BOOTSTRAP_NODES,...global.SYMBIOTE_META.PEERS],




GET_QUORUM_URLS_AND_PUBKEYS = async (withPubkey,epochHandler) => {

    let toReturn = []

    epochHandler ||= WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    for(let pubKey of epochHandler.quorum){

        let poolStorage = BLOCKCHAIN_METADATA.APPROVEMENT_THREAD_CACHE.get(pubKey+'(POOL)_STORAGE_POOL') || await GET_FROM_APPROVEMENT_THREAD_STATE(pubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        if(poolStorage){

            toReturn.push(withPubkey ? {url:poolStorage.poolURL,pubKey} : poolStorage.poolURL)
        
        }

    }

    return toReturn

},




// BLOCKCHAIN_METADATA.VERSION shows the real software version of appropriate workflow
//We use this function on VERIFICATION_THREAD and APPROVEMENT_THREAD to make sure we can continue to work
//If major version was changed and we still has an old version - we should stop node and update software
IS_MY_VERSION_OLD = threadID => WORKING_THREADS[threadID].VERSION > BLOCKCHAIN_METADATA.VERSION,




EPOCH_STILL_FRESH = thread => thread.EPOCH.startTimestamp + thread.WORKFLOW_OPTIONS.EPOCH_TIME > GET_UTC_TIMESTAMP(),




GET_MAJORITY = epochHandler => {

    let quorumNumber = epochHandler.quorum.length

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




DECRYPT_KEYS=async()=>{
    
    let readLineInterface = readline.createInterface({input: process.stdin,output: process.stdout,terminal:false})


    LOG(`Blockchain info \x1b[32;1m(\x1b[36;1mworkflow:${BLOCKCHAIN_GENESIS.WORKFLOW}[QT major version:${BLOCKCHAIN_METADATA.VERSION}] / your pubkey:${CONFIGURATION.NODE_LEVEL.PUBLIC_KEY}\x1b[32;1m)`,COLORS.CYAN)


    
    let hexSeed = await new Promise(resolve=>
        
        readLineInterface.question(`\n ${COLORS.TIME_COLOR}[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})${COLORS.CLEAR}  Enter \x1b[32mpassword\x1b[0m to decrypt private key in memory of process ———> \x1b[31m`,resolve)
        
    )
        

    // Get 32 bytes SHA256(Password)

    hexSeed = cryptoModule.createHash('sha256').update(hexSeed,'utf-8').digest('hex')

    let initializationVector = Buffer.from(hexSeed.slice(32),'hex') // Get second 16 bytes for initialization vector


    console.log('\x1b[0m')

    hexSeed = hexSeed.slice(0,32) // Retrieve first 16 bytes from hash



    //__________________________________________DECRYPT PRIVATE KEY____________________________________________


    let decipher = cryptoModule.createDecipheriv('aes-256-cbc',hexSeed,initializationVector)
    
    CONFIGURATION.NODE_LEVEL.PRIVATE_KEY = decipher.update(CONFIGURATION.NODE_LEVEL.PRIVATE_KEY,'hex','utf8')+decipher.final('utf8')

    
    readLineInterface.close()

}