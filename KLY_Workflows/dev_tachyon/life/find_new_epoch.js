import {GRACEFUL_STOP, BLOCKCHAIN_DATABASES, WORKING_THREADS, GLOBAL_CACHES, EPOCH_METADATA_MAPPING} from '../blockchain_preparation.js'

import {getCurrentEpochQuorum, getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {getFirstBlockOnEpoch, verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {blake3Hash, logColors, customLog, pathResolve} from '../../../KLY_Utils/utils.js'

import {setLeadersSequenceForShards} from './shards_leaders_monitoring.js'

import {getBlock} from '../verification_process/verification.js'

import {epochStillFresh, isMyCoreVersionOld} from '../utils.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import Block from '../structures/block.js'

import level from 'level'

import fs from 'fs'




export let executeEpochEdgeTransaction = async() => {


    let senderAccount = await getAccountFromState(originShard+':'+tx.creator)


    tx = await TXS_FILTERS.WVM_CALL(tx,originShard) // pass through the filter


    if(tx && tx.fee >= 0 && senderAccount.type==='eoa' && senderAccount.nonce < tx.nonce){

        let goingToSpend = calculateAmountToSpendAndGasToBurn(tx)

        if(!goingToSpend.errReason){

            if(senderAccount.balance - goingToSpend.goingToSpendInNativeCurrency >= 0 && senderAccount.gas - goingToSpend.goingToBurnGasAmount >= 0){

                let execResultWithStatusAndReason

                if(tx.payload.contractID?.startsWith('system/')){

                    // Call system smart-contract
    
                    let systemContractName = tx.payload.contractID.split('/')[1]
    
                    if(SYSTEM_CONTRACTS.has(systemContractName)){
    
                        let systemContract = SYSTEM_CONTRACTS.get(systemContractName)
                        
                        execResultWithStatusAndReason = await systemContract[tx.payload.method](originShard,tx,atomicBatch) // result is {isOk:true/false, reason:''}
    
                    } else execResultWithStatusAndReason = {isOk:false,reason:`No such type of system contract`}
            
                }

                senderAccount.balance -= goingToSpend.goingToSpendInNativeCurrency

                senderAccount.gas -= goingToSpend.goingToBurnGasAmount
        
                senderAccount.nonce = tx.nonce
                
                rewardsAndSuccessfulTxsCollector.fees += tx.fee

                return execResultWithStatusAndReason

            } else return {isOk:false,reason:`Not enough native currency or gas to execute transaction`}

        } else return {isOk:false,reason:goingToSpend.errReason}

    } else return {isOk:false,reason:`Can't get filtered value of tx`}

}




// Use it to find checkpoints on hostchains, perform them and join to QUORUM by finding the latest valid checkpoint

export let findAggregatedEpochFinalizationProofs=async()=>{


    //_________________________FIND THE NEXT CHECKPOINT AND EXECUTE EPOCH EDGE TRANSACTIONS INSTANTLY_____________________________

    /*
    

        1. Check if new epoch must be started(new day by default)

        2. Try to find AEFPs(Aggregated Epoch Finalization Proofs) for each of shards by calling GET /aggregated_epoch_finalization_proof/:EPOCH_INDEX/:SHARD_ID

            Reminder - the structure of AEFP must be:

                {

                    shard,

                    lastLeader,
                    
                    lastIndex,
                    
                    lastHash,

                    hashOfFirstBlockByLastLeader,

                    proofs:{

                        ed25519PubKey0:ed25519Signa0,
                        ...
                        ed25519PubKeyN:ed25519SignaN
                         
                    }
                
                }

                Data that must be signed by 2/3N+1 => 'EPOCH_DONE'+shard+lastLeader+lastIndex+lastHash+hashOfFirstBlockByLastLeader+checkpointFullID

        3. Once we find the AEFPs for ALL the shards - it's a signal to start to find the first X blocks in current epoch for each shard

            We'll use 1 option for this:

                [*] WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.MAX_NUM_OF_BLOCKS_PER_SHARD_FOR_SYNC_OPS - 1 by default. Don't change it
                
                    This value shows how many first blocks we need to get to extract epoch edge transactions to execute before move to next epoch
                    
                    Epoch edge transactions used mostly for staking/unstaking operations, to change network params(e.g. epoch time, minimal stake,etc.)
 
            
        4. Now try to find our own assumption about the first block in epoch locally

            For this, iterate over leaders sequences for shards:
            
            
            for(shardID of shards){

                Try to find first block created by other pools on this shard

                for(pool of leadersSequence[shardID])

            }
                        
            and try to find AFP_FOR_FIRST_BLOCK => await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:epochID:PubKey:0').catch(()=>false)

            If we can't get it - make call to GET /aggregated_finalization_proof/:BLOCK_ID to quorum members

            In case we have AFP for the first block(with index 0) - it's a clear proof that block 0 is 100% accepted by network and we can get the hash of first block from here:

                AFP_FOR_FIRST_BLOCK.blockHash
 

        6. Once we find all of them - extract EPOCH_EDGE_TRANSACTIONS from block headers and run it in a sync mode

        7. Increment value of checkpoint index(checkpoint.id) and recount new hash(checkpoint.hash)
    
        8. Prepare new object in TEMP(checkpointFullID) and set new version of checkpoint on AT
    
    
    */

    if(!epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)){

        let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

        let oldEpochFullID = atEpochHandler.hash+"#"+atEpochHandler.id
    
        let temporaryObject = EPOCH_METADATA_MAPPING.get(oldEpochFullID)
    
        if(!temporaryObject){
    
            setTimeout(findAggregatedEpochFinalizationProofs,3000)
    
            return
    
        }


        // let numberOfFirstBlocksToFetchFromEachShard = WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.MAX_NUM_OF_BLOCKS_PER_SHARD_FOR_SYNC_OPS // 1. DO NOT CHANGE

        let totalNumberOfShards = 0

        let totalNumberOfReadyShards = 0

        let leadersSequence = atEpochHandler.leadersSequence

        let majority = getQuorumMajority(atEpochHandler)

        let allKnownPeers = await getQuorumUrlsAndPubkeys()

        // Get the special object from DB not to repeat requests

        let epochCache = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_CACHE:${oldEpochFullID}`).catch(()=>null) || {} // {shardID:{firstBlockCreator,firstBlockHash,aefp,firstBlockOnShardFound}}

        let entries = Object.entries(leadersSequence)

        //____________________Ask the quorum for AEFP for shard___________________
        
        for(let [shardID] of entries){
        
            totalNumberOfShards++
        
            if(!epochCache[shardID]) epochCache[shardID] = {firstBlockOnShardFound:false}

            if(epochCache[shardID].aefp && epochCache[shardID].firstBlockOnShardFound){

                totalNumberOfReadyShards++

                // No more sense to find AEFPs or first block for this shard. Just continue

                continue

            }

            /*
        
                ███████╗██╗███╗   ██╗██████╗      █████╗ ███████╗███████╗██████╗ ███████╗
                ██╔════╝██║████╗  ██║██╔══██╗    ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝
                █████╗  ██║██╔██╗ ██║██║  ██║    ███████║█████╗  █████╗  ██████╔╝███████╗
                ██╔══╝  ██║██║╚██╗██║██║  ██║    ██╔══██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║
                ██║     ██║██║ ╚████║██████╔╝    ██║  ██║███████╗██║     ██║     ███████║
                ╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝     ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝     ╚══════╝

                
                Reminder: AEFP structure is

                    {
                        shard:<ID of shard>,
                        lastLeader:<index of ed25519 pubkey of some pool in sequence of pool for this shard in current epoch>,
                        lastIndex:<index of his block in previous epoch>,
                        lastHash:<hash of this block>,
                        hashOfFirstBlockByLastLeader,
                        
                        proofs:{

                            ed25519PubKey0:ed25519Signa0,
                            ...
                            ed25519PubKeyN:ed25519SignaN
                         
                        }
    
                    }

            */

            
            if(!epochCache[shardID].aefp){

                // Try to find locally

                let aefp = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${atEpochHandler.id}:${shardID}`).catch(()=>false)

                if(aefp){

                    epochCache[shardID].aefp = aefp

                }else{

                    // Ask quorum for AEFP
                    for(let peerURL of allKnownPeers){
            
                        let itsProbablyAggregatedEpochFinalizationProof = await fetch(peerURL+`/aggregated_epoch_finalization_proof/${atEpochHandler.id}/${shardID}`).then(r=>r.json()).catch(()=>false)
                
                        if(itsProbablyAggregatedEpochFinalizationProof){
                
                            let aefpPureObject = await verifyAggregatedEpochFinalizationProof(itsProbablyAggregatedEpochFinalizationProof,atEpochHandler.quorum,majority,oldEpochFullID)
    
                            if(aefpPureObject && aefpPureObject.shard === shardID){
    
                                epochCache[shardID].aefp = aefpPureObject

                                // Store locally

                                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`AEFP:${atEpochHandler.id}:${shardID}`,aefpPureObject).catch(()=>{})

                                // No sense to find more

                                break
    
                            }
                                        
                        }
                
                    }

                }

            }
            


            /*
        
                ███████╗██╗███╗   ██╗██████╗     ███████╗██╗██████╗ ███████╗████████╗    ██████╗ ██╗      ██████╗  ██████╗██╗  ██╗███████╗
                ██╔════╝██║████╗  ██║██╔══██╗    ██╔════╝██║██╔══██╗██╔════╝╚══██╔══╝    ██╔══██╗██║     ██╔═══██╗██╔════╝██║ ██╔╝██╔════╝
                █████╗  ██║██╔██╗ ██║██║  ██║    █████╗  ██║██████╔╝███████╗   ██║       ██████╔╝██║     ██║   ██║██║     █████╔╝ ███████╗
                ██╔══╝  ██║██║╚██╗██║██║  ██║    ██╔══╝  ██║██╔══██╗╚════██║   ██║       ██╔══██╗██║     ██║   ██║██║     ██╔═██╗ ╚════██║
                ██║     ██║██║ ╚████║██████╔╝    ██║     ██║██║  ██║███████║   ██║       ██████╔╝███████╗╚██████╔╝╚██████╗██║  ██╗███████║
                ╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝       ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝
    
            */

            if(!epochCache[shardID].firstBlockOnShardFound){

                let findResult = await getFirstBlockOnEpoch(atEpochHandler,shardID,getBlock)

                if(findResult){

                    epochCache[shardID].firstBlockCreator = findResult.firstBlockCreator

                    epochCache[shardID].firstBlockHash = findResult.firstBlockHash

                    epochCache[shardID].firstBlockOnShardFound = true

                }

            }

            
            //___________________ Here we should have understanding of first block for each shard on this epoch __________________________

            if(epochCache[shardID].firstBlockOnShardFound && epochCache[shardID].aefp) totalNumberOfReadyShards++

            if(!epochCache[shardID].firstBlockHash) epochCache[shardID] = {}
    
        
        }

        // Store the changes in CHECKPOINT_CACHE for persistence

        await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_CACHE:${oldEpochFullID}`,epochCache).catch(()=>false)


        //_____Now, when we've resolved all the first blocks & found all the AEFPs - get blocks, extract epoch edge transactions and set the new epoch____


        if(totalNumberOfShards === totalNumberOfReadyShards){

            let epochEdgeTransactions = []

            let firstBlocksHashes = []

            let cycleWasBreak = false

            for(let [shardID] of entries){

                // Try to get the epoch edge transactions from the first blocks

                let firstBlockOnThisShard = await getBlock(atEpochHandler.id,epochCache[shardID].firstBlockCreator,0)

                if(firstBlockOnThisShard && Block.genHash(firstBlockOnThisShard) === epochCache[shardID].firstBlockHash){

                    if(Array.isArray(firstBlockOnThisShard.epochEdgeTransactions)){

                        epochEdgeTransactions.push(...firstBlockOnThisShard.epochEdgeTransactions)

                    }

                    firstBlocksHashes.push(epochCache[shardID].firstBlockHash)

                }else{

                    cycleWasBreak = true

                    break

                }

            }

            if(!cycleWasBreak){

                // Store the epoch edge transactions locally because we'll need it later(to change the epoch on VT - Verification Thread)
                // So, no sense to grab it twice(on AT and later on VT). On VT we just get it from DB and execute these transactions
                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_EDGE_TXS:${oldEpochFullID}`,epochEdgeTransactions).catch(()=>false)


                // Store the legacy data about this epoch that we'll need in future - epochFullID,quorum,majority
                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`LEGACY_DATA:${atEpochHandler.id}`,{

                    epochFullID:oldEpochFullID,
                    quorum:atEpochHandler.quorum,
                    majority

                }).catch(()=>{})

                // For API - store the whole epoch handler object by epoch numerical index
                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_HANDLER:${atEpochHandler.id}`,atEpochHandler).catch(()=>{})
                                
                // ... and delete the legacy data for previos epoch(don't need it anymore for approvements)
                await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`LEGACY_DATA:${atEpochHandler.id-1}`).catch(()=>{})

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

                let atomicBatch = BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.batch()

                for(let operation of epochEdgeTransactions){

                    /*
                    
                        operation structure is:

                        {   v,
                            fee,
                            creator,
                            type,
                            nonce,
                            payload:{

                                contractID, method, gasLimit, params, imports, shardContext

                            },
                            sig
        
                        }
                    
                    */
        
                    await EPOCH_EDGE_OPERATIONS_VERIFIERS[operation.type](operation.payload,false,true,fullCopyOfApprovementThread)
                
                }
                
                // After all ops - commit state and make changes to workflow
            
                GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.forEach((value,recordID)=>{
            
                    atomicBatch.put(recordID,value)
            
                })

               
                // Now, after the execution we can change the checkpoint id and get the new hash + prepare new temporary object
                
                let nextEpochId = atEpochHandler.id + 1

                let nextEpochHash = blake3Hash(JSON.stringify(firstBlocksHashes))

                let nextEpochFullID = nextEpochHash+'#'+nextEpochId


                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`NEXT_EPOCH_HASH:${oldEpochFullID}`,nextEpochHash).catch(()=>{})


                // After execution - assign pools(validators) to shards
                await setLeadersSequenceForShards(atEpochHandler,nextEpochHash)

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`NEXT_EPOCH_LEADERS_SEQUENCES:${oldEpochFullID}`,WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.leadersSequence).catch(()=>{})


                customLog(`\u001b[38;5;154mEpoch edge transactions were executed for epoch \u001b[38;5;93m${oldEpochFullID} (AT)\u001b[0m`,logColors.GREEN)

                //_______________________ Update the values for new epoch _______________________

                fullCopyOfApprovementThread.EPOCH.startTimestamp = atEpochHandler.startTimestamp + fullCopyOfApprovementThread.NETWORK_PARAMETERS.EPOCH_TIME

                fullCopyOfApprovementThread.EPOCH.id = nextEpochId

                fullCopyOfApprovementThread.EPOCH.hash = nextEpochHash

                fullCopyOfApprovementThread.EPOCH.quorum = getCurrentEpochQuorum(fullCopyOfApprovementThread.EPOCH.poolsRegistry,fullCopyOfApprovementThread.NETWORK_PARAMETERS,nextEpochHash)

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`NEXT_EPOCH_QUORUM:${oldEpochFullID}`,fullCopyOfApprovementThread.EPOCH.quorum).catch(()=>{})
                
                // Create new temporary db for the next epoch
                let nextTempDB = level(process.env.CHAINDATA_PATH+`/${nextEpochFullID}`,{valueEncoding:'json'})

                // Commit changes
                atomicBatch.put('AT',fullCopyOfApprovementThread)

                await atomicBatch.write()


                // Create mappings & set for the next epoch
                let nextTemporaryObject = {

                    FINALIZATION_PROOFS:new Map(),

                    FINALIZATION_STATS:new Map(),

                    TEMP_CACHE:new Map(),

                    EPOCH_EDGE_TRANSACTIONS_MEMPOOL:[],

                    SYNCHRONIZER:new Map(),
            
                    SHARDS_LEADERS_HANDLERS:new Map(),
      
                    DATABASE:nextTempDB
            
                }


                WORKING_THREADS.APPROVEMENT_THREAD = fullCopyOfApprovementThread

                customLog(`Epoch on approvement thread was updated => \x1b[34;1m${nextEpochHash}#${nextEpochId}`,logColors.GREEN)


                //_______________________Check the version required for the next checkpoint________________________


                if(isMyCoreVersionOld('APPROVEMENT_THREAD')){

                    customLog(`New version detected on APPROVEMENT_THREAD. Please, upgrade your node software`,logColors.YELLOW)

                    console.log('\n')
                    console.log(fs.readFileSync(pathResolve('images/events/update.txt')).toString())
        
                    // Stop the node to update the software
                    GRACEFUL_STOP()

                }


                // Close & delete the old temporary db
            
                await EPOCH_METADATA_MAPPING.get(oldEpochFullID).DATABASE.close()
        
                fs.rm(process.env.CHAINDATA_PATH+`/${oldEpochFullID}`,{recursive:true},()=>{})
        
                EPOCH_METADATA_MAPPING.delete(oldEpochFullID)

                
                
                //________________________________ If it's fresh checkpoint and we present there as a member of quorum - then continue the logic ________________________________


                let iAmInTheQuorum = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum.includes(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)


                if(epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD) && iAmInTheQuorum){

                    // Fill the checkpoints manager with the latest data

                    let currentEpochManager = nextTemporaryObject.FINALIZATION_STATS

                    WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.poolsRegistry.forEach(poolPubKey=>

                        currentEpochManager.set(poolPubKey,{index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}})

                    )

                }

                // Set next temporary object by ID

                EPOCH_METADATA_MAPPING.set(nextEpochFullID,nextTemporaryObject)

                // Delete the cache that we don't need more

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`EPOCH_CACHE:${oldEpochFullID}`).catch(()=>{})


            }

        }

        // Continue to find
        setImmediate(findAggregatedEpochFinalizationProofs)

    }else{

        setTimeout(findAggregatedEpochFinalizationProofs,3000)

    }

}