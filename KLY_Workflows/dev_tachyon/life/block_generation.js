import {

    GET_ALL_KNOWN_PEERS

} from '../utils.js'

import {GET_VERIFIED_AGGREGATED_FINALIZATION_PROOF_BY_BLOCK_ID, VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF, VERIFY_AGGREGATED_FINALIZATION_PROOF} from '../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, NODE_METADATA, WORKING_THREADS} from '../blockchain_preparation.js'

import {ED25519_SIGN_DATA, ED25519_VERIFY} from '../../../KLY_Utils/utils.js'

import {BLOCKLOG} from '../common_functions/logging.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import Block from '../structures/block.js'

import fetch from 'node-fetch'

import {GET_QUORUM_MAJORITY, GET_QUORUM_URLS_AND_PUBKEYS} from '../common_functions/quorum_related.js'





export let BLOCKS_GENERATION=async()=>{

    await GENERATE_BLOCKS_PORTION()

    setTimeout(BLOCKS_GENERATION,WORKING_THREADS.APPROVEMENT_THREAD.WORKFLOW_OPTIONS.BLOCK_TIME)
 
}




let GET_TRANSACTIONS = () => NODE_METADATA.MEMPOOL.splice(0,WORKING_THREADS.APPROVEMENT_THREAD.WORKFLOW_OPTIONS.TXS_LIMIT_PER_BLOCK)

let GET_EPOCH_EDGE_OPERATIONS = epochFullID => {

    if(!EPOCH_METADATA_MAPPING.has(epochFullID)) return []

    let epochEdgeOperationsMempool = EPOCH_METADATA_MAPPING.get(epochFullID).EPOCH_EDGE_OPERATIONS_MEMPOOL

    return epochEdgeOperationsMempool.splice(0,WORKING_THREADS.APPROVEMENT_THREAD.WORKFLOW_OPTIONS.EPOCH_EDGE_OPERATIONS_LIMIT_PER_BLOCK)

}




/*

Function to find the AGGREGATED_EPOCH_FINALIZATION_PROOFS for appropriate shard

Ask the network in special order:

    1) Special configured URL (it might be plugin's API)
    2) Quorum members
    3) Other known peers

*/
let GET_AGGREGATED_EPOCH_FINALIZATION_PROOF_FOR_PREVIOUS_EPOCH = async() => {


    let allKnownNodes = [CONFIGURATION.NODE_LEVEL.GET_PREVIOUS_EPOCH_AGGREGATED_FINALIZATION_PROOF_URL,...await GET_QUORUM_URLS_AND_PUBKEYS(),...GET_ALL_KNOWN_PEERS()]

    let shardID = CONFIGURATION.NODE_LEVEL.PRIME_POOL_PUBKEY || CONFIGURATION.NODE_LEVEL.PUBLIC_KEY

    // Find locally

    let aefpProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${WORKING_THREADS.GENERATION_THREAD.epochIndex}:${shardID}`).catch(()=>null)

    if(aefpProof) return aefpProof

    else {

        for(let nodeEndpoint of allKnownNodes){

            let finalURL = `${nodeEndpoint}/aggregated_epoch_finalization_proof/${WORKING_THREADS.GENERATION_THREAD.epochIndex}/${shardID}`
    
            let itsProbablyAggregatedEpochFinalizationProof = await fetch(finalURL).then(r=>r.json()).catch(()=>false)
    
            let aefpProof = itsProbablyAggregatedEpochFinalizationProof?.shard === shardID && await VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF(
                
                itsProbablyAggregatedEpochFinalizationProof,
    
                WORKING_THREADS.GENERATION_THREAD.quorum,
    
                WORKING_THREADS.GENERATION_THREAD.majority,        
    
                WORKING_THREADS.GENERATION_THREAD.epochFullId
            
            )
    
            if(aefpProof) return aefpProof
    
        }    

    }
    
},




GET_AGGREGATED_LEADER_ROTATION_PROOF = async (epochHandler,pubKeyOfOneOfPreviousLeader,hisIndexInLeadersSequence,shardID) => {

    /**
    * This function is used once you become shard leader and you need to get the ALRPs for all the previous leaders
    * on this shard till the pool which was reassigned on non-zero height
    */

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){

        return

    }

    // Prepare the template that we're going to send to quorum to get the ALRP
    // Send payload to => POST /leader_rotation_proof

    let firstBlockIDByThisLeader = epochHandler.id+':'+pubKeyOfOneOfPreviousLeader+':0' // epochID:PubKeyOfCreator:0 - first block in epoch

    let afpForFirstBlock = await GET_VERIFIED_AGGREGATED_FINALIZATION_PROOF_BY_BLOCK_ID(firstBlockIDByThisLeader,epochHandler)

    let firstBlockHash

    let localFinalizationStatsForThisPool = currentEpochMetadata.FINALIZATION_STATS.get(pubKeyOfOneOfPreviousLeader) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}


    if(localFinalizationStatsForThisPool.index === -1){

        localFinalizationStatsForThisPool.hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

        afpForFirstBlock = null

    }


    // Set the hash of first block for pool
    // In case previous leader created zero blocks - set the <firstBlockHash> to "null-hash-value"('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    // Otherwise, if at least one block was created & shared among quorum - take the hash value from AFP (.blockHash field(see AFP structure))
    if(!afpForFirstBlock && localFinalizationStatsForThisPool.index === -1) firstBlockHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

    else if(afpForFirstBlock) firstBlockHash = afpForFirstBlock.blockHash

    else return


    // In case we haven't define hash of first block - stop searching process. Try next time

    if(firstBlockHash){

        let responsePromises = []

        let sendOptions = {
     
            method:'POST',
    
            body:JSON.stringify({
    
                poolPubKey:pubKeyOfOneOfPreviousLeader,

                hisIndexInLeadersSequence,
    
                shard:shardID,
    
                afpForFirstBlock,
    
                skipData:localFinalizationStatsForThisPool
    
            })
    
        }

        let quorumMembers = await GET_QUORUM_URLS_AND_PUBKEYS(true,epochHandler)


        // Descriptor is {url,pubKey}
        for(let descriptor of quorumMembers){

            let responsePromise = fetch(descriptor.url+'/leader_rotation_proof',sendOptions).then(r=>r.json()).then(response=>{

                response.pubKey = descriptor.pubKey
       
                return response
       
            }).catch(()=>false)
       
            responsePromises.push(responsePromise)            
    
        }

        let results = (await Promise.all(responsePromises)).filter(Boolean)

        /*
 
            ___________________________ Now analyze the responses ___________________________

            [1] In case quroum member has the same or lower index in own FINALIZATION_STATS for this pool - we'll get the response like this:

            {
                type:'OK',
                sig: ED25519_SIG('LEADER_ROTATION_PROOF:<poolPubKey>:<firstBlockHash>:<skipIndex>:<skipHash>:<epochFullID>')
            }

            We should just verify this signature and add to local list for further aggregation
            And this quorum member update his own local version of FP to have FP with bigger index


            [2] In case quorum member has bigger index in FINALIZATION_STATS - it sends us 'UPDATE' message with the following format:

            {
                
                type:'UPDATE',
             
                skipData:{
                 
                    index,
                    hash,
                    afp:{

                        prevBlockHash,      => must be the same as skipData.hash
                        blockID,            => must be skipData.index+1 === blockID
                        blockHash,
                        proofs:{

                            pubKey0:signa0,         => prevBlockHash+blockID+blockHash+QT.EPOCH.HASH+"#"+QT.EPOCH.id
                            ...

                        }

                    }

                }
             
            }


            Again - we should verify the signature, update local version of FINALIZATION_STATS and repeat the grabbing procedure

        */


        let skipAgreementSignatures = {} // pubkey => signa

        let totalNumberOfSignatures = 0
            
        let dataThatShouldBeSigned = `LEADER_ROTATION_PROOF:${pubKeyOfOneOfPreviousLeader}:${firstBlockHash}:${localFinalizationStatsForThisPool.index}:${localFinalizationStatsForThisPool.hash}:${epochFullID}`
        
        let majority = GET_QUORUM_MAJORITY(epochHandler)
        

        // Start the cycle over results

        for(let result of results){

            if(result.type === 'OK' && typeof result.sig === 'string'){
        
                let signatureIsOk = await ED25519_VERIFY(dataThatShouldBeSigned,result.sig,result.pubKey)
        
                if(signatureIsOk){
        
                    skipAgreementSignatures[result.pubKey] = result.sig
        
                    totalNumberOfSignatures++
        
                }
        
                // If we get 2/3N+1 signatures to skip - we already have ability to create <aggregatedSkipProof>
        
                if(totalNumberOfSignatures >= majority) break
        
        
            }else if(result.type === 'UPDATE' && typeof result.skipData === 'object'){
        
        
                let {index,hash,afp} = result.skipData
        
                let blockIdInAfp = (epochHandler.id+':'+pubKeyOfOneOfPreviousLeader+':'+index)
        
        
                if(typeof afp === 'object' && hash === afp.blockHash && blockIdInAfp === afp.blockID && await VERIFY_AGGREGATED_FINALIZATION_PROOF(afp,epochHandler)){
        
                    // If signature is ok and index is bigger than we have - update the <skipData> in our local skip handler
         
                    if(localFinalizationStatsForThisPool.index < index){
                         
                        let {prevBlockHash,blockID,blockHash,proofs} = afp
                         
        
                        localFinalizationStatsForThisPool.index = index
        
                        localFinalizationStatsForThisPool.hash = hash
        
                        localFinalizationStatsForThisPool.afp = {prevBlockHash,blockID,blockHash,proofs}
         
    
                        // Store the updated version of finalization stats

                        currentEpochMetadata.FINALIZATION_STATS.set(pubKeyOfOneOfPreviousLeader,localFinalizationStatsForThisPool)                    
    
                        // If our local version had lower index - break the cycle and try again next time with updated value
        
                        break
        
                    }
        
                }
             
            }
        
        }


        //____________________If we get 2/3+1 of LRPs - aggregate and get the ALRP(<aggregated LRP>)____________________

        if(totalNumberOfSignatures >= majority){

            return {

                firstBlockHash,

                skipIndex:localFinalizationStatsForThisPool.index,

                skipHash:localFinalizationStatsForThisPool.hash,

                proofs:skipAgreementSignatures

            }

        }

    }

}




let GENERATE_BLOCKS_PORTION = async() => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let epochIndex = epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata) return


    //_________________ No sense to generate blocks more in case we haven't approved the previous ones _________________

    let proofsGrabber = currentEpochMetadata.TEMP_CACHE.get('PROOFS_GRABBER')


    if(proofsGrabber && WORKING_THREADS.GENERATION_THREAD.nextIndex > proofsGrabber.acceptedIndex+1) return

    //__________________________________________________________________________________________________________________


    if(!currentEpochMetadata.TEMP_CACHE.has('CAN_PRODUCE_BLOCKS')){

        let poolPresent = epochHandler.poolsRegistry[CONFIGURATION.NODE_LEVEL.PRIME_POOL_PUBKEY ? 'reservePools' : 'primePools' ].includes(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY) 

        currentEpochMetadata.TEMP_CACHE.set('CAN_PRODUCE_BLOCKS',poolPresent)

    }


    //Safe "if" branch to prevent unnecessary blocks generation
    if(!currentEpochMetadata.TEMP_CACHE.get('CAN_PRODUCE_BLOCKS')) return

    let myDataInShardsLeadersMonitoring = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)



    if(typeof myDataInShardsLeadersMonitoring === 'object') return


    // Check if <epochFullID> is the same in QT and in GT

    if(WORKING_THREADS.GENERATION_THREAD.epochFullId !== epochFullID){

        // If new epoch - add the aggregated proof of previous epoch finalization

        if(epochIndex !== 0){

            let aefpForPreviousEpoch = await GET_AGGREGATED_EPOCH_FINALIZATION_PROOF_FOR_PREVIOUS_EPOCH()

            // If we can't find a proof - try to do it later
            // Only in case it's initial epoch(index is -1) - no sense to push it
            if(!aefpForPreviousEpoch) return

            WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch = aefpForPreviousEpoch

        }

        // Update the index & hash of epoch

        WORKING_THREADS.GENERATION_THREAD.epochFullId = epochFullID

        WORKING_THREADS.GENERATION_THREAD.epochIndex = epochIndex

        // Recount new values

        WORKING_THREADS.GENERATION_THREAD.quorum = epochHandler.quorum

        WORKING_THREADS.GENERATION_THREAD.majority = GET_QUORUM_MAJORITY(epochHandler)


        // And nullish the index & hash in generation thread for new epoch

        WORKING_THREADS.GENERATION_THREAD.prevHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
 
        WORKING_THREADS.GENERATION_THREAD.nextIndex = 0
    
    }


    let extraData = {}

    //___________________ Add the AEFP to the first block of epoch ___________________

    if(WORKING_THREADS.GENERATION_THREAD.epochIndex > 0){

        // Add the AEFP for previous epoch

        extraData.aefpForPreviousEpoch = WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch

        if(!extraData.aefpForPreviousEpoch) return


    }
    
    // If we are even not in reserve - return

    if(typeof myDataInShardsLeadersMonitoring === 'string'){

        // Do it only for the first block in epoch(with index 0)

        if(WORKING_THREADS.GENERATION_THREAD.nextIndex === 0){

            // Build the template to insert to the extraData of block. Structure is {primePool:ALRP,reservePool0:ALRP,...,reservePoolN:ALRP}
        
            let myPrimePool = CONFIGURATION.NODE_LEVEL.PRIME_POOL_PUBKEY

            let leadersSequenceOfMyShard = epochHandler.leadersSequence[myPrimePool]
    
            let myIndexInLeadersSequenceForShard = leadersSequenceOfMyShard.indexOf(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)
    

            // Get all previous pools - from zero to <my_position>

            let pubKeysOfAllThePreviousPools = leadersSequenceOfMyShard.slice(0,myIndexInLeadersSequenceForShard).reverse()


            // Add the pubkey of prime pool because we have to add the ALRP for it too

            pubKeysOfAllThePreviousPools.push(myPrimePool)



            //_____________________ Fill the extraData.aggregatedLeadersRotationProofs _____________________


            extraData.aggregatedLeadersRotationProofs = {}

            /*

                Here we need to fill the object with aggregated leader rotation proofs (ALRPs) for all the previous pools till the pool which was rotated on not-zero height
            
                If we can't find all the required ALRPs - skip this iteration to try again later

            */

            // Add the ALRP for the previous pools in leaders sequence

            let indexOfPreviousLeaderInSequence = myIndexInLeadersSequenceForShard-1

            for(let pubKeyOfPreviousLeader of pubKeysOfAllThePreviousPools){

                let aggregatedLeaderRotationProof = await GET_AGGREGATED_LEADER_ROTATION_PROOF(epochHandler,pubKeyOfPreviousLeader,indexOfPreviousLeaderInSequence,myPrimePool).catch(()=>null)

                if(aggregatedLeaderRotationProof){

                    extraData.aggregatedLeadersRotationProofs[pubKeyOfPreviousLeader] = aggregatedLeaderRotationProof

                    if(aggregatedLeaderRotationProof.skipIndex >= 0) break // if we hit the ALRP with non-null index(at least index >= 0) it's a 100% that reassignment chain is not broken, so no sense to push ALRPs for previous pools 

                    indexOfPreviousLeaderInSequence--

                } else return

            }

        }


    }else if(CONFIGURATION.NODE_LEVEL.PRIME_POOL_PUBKEY) return
    

    /*

    _________________________________________GENERATE PORTION OF BLOCKS___________________________________________
    
    Here we check how many transactions(events) we have locally and generate as many blocks as it's possible
    
    */

    let numberOfBlocksToGenerate = Math.ceil(NODE_METADATA.MEMPOOL.length / WORKING_THREADS.APPROVEMENT_THREAD.WORKFLOW_OPTIONS.TXS_LIMIT_PER_BLOCK)




    //_______________________________________FILL THE BLOCK WITH EXTRA DATA_________________________________________

    // 0.Add the epoch edge operations to block extra data

    extraData.epochEdgeOperations = GET_EPOCH_EDGE_OPERATIONS(WORKING_THREADS.GENERATION_THREAD.epochFullId)

    // 1.Add the extra data to block from configs(it might be your note, for instance)

    extraData.rest = {...CONFIGURATION.NODE_LEVEL.EXTRA_DATA_TO_BLOCK}


    if(numberOfBlocksToGenerate===0) numberOfBlocksToGenerate++

    let atomicBatch = BLOCKCHAIN_DATABASES.BLOCKS.batch()

    for(let i=0;i<numberOfBlocksToGenerate;i++){


        let blockCandidate = new Block(GET_TRANSACTIONS(),extraData,WORKING_THREADS.GENERATION_THREAD.epochFullId)
                        
        let hash = Block.genHash(blockCandidate)


        blockCandidate.sig = await ED25519_SIGN_DATA(hash,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
            
        BLOCKLOG(`New block generated`,hash,blockCandidate,WORKING_THREADS.GENERATION_THREAD.epochIndex)


        WORKING_THREADS.GENERATION_THREAD.prevHash = hash
 
        WORKING_THREADS.GENERATION_THREAD.nextIndex++
    
        // BlockID has the following format => epochID(epochIndex):Ed25519_Pubkey:IndexOfBlockInCurrentEpoch
        let blockID = WORKING_THREADS.GENERATION_THREAD.epochIndex+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+blockCandidate.index

        //Store block locally
        atomicBatch.put(blockID,blockCandidate)
           
    }

    //Update the GENERATION_THREAD after all
    atomicBatch.put('GT',WORKING_THREADS.GENERATION_THREAD)

    await atomicBatch.write()

}