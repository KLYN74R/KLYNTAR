import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../blockchain_preparation.js'

import {getFromApprovementThreadState} from '../../common_functions/approvement_thread_related.js'

import {getFromState} from '../../common_functions/state_interactions.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'




/**## Returns the data directrly from state
 * 
 * 
 * ### Info
 * 
 *  This GET route returns data from state - it might be account, contract metadata, contract storage, KLY-EVM address binding and so on!
 * 
 * 
 * ### Params
 * 
 *  + 0 - shardID - Base58 encoded 32-byte Ed25519 public key which is also ID of shard
 *  + 1 - cellID - identifier of what you want to get - contract ID, account address(Base58 ed25519,BLS,LRS,PQC,TSIG, and so on), etc.
 * 
 * 
 * ### Returns
 * 
 *  + JSON'ed value
 * 
 *  
 * */
FASTIFY_SERVER.get('/state/:shardID/:cellID',async(request,response)=>{


    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.FROM_STATE){

        let shardContext = request.params.shardID

        let cellID = request.params.cellID

        let fullID = shardContext === 'x' ? cellID : shardContext+':'+cellID

        let data = await BLOCKCHAIN_DATABASES.STATE.get(fullID).catch(()=>null)


        response

            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.FROM_STATE)
        
            .send(data)
    
    }else response.send({err:'Trigger is off'})

})


// 0 - txid
FASTIFY_SERVER.get('/tx_receipt/:txid',(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.TX_RECEIPT){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.TX_RECEIPT}`)
            

        BLOCKCHAIN_DATABASES.STATE.get('TX:'+request.params.txid).then(
            
            txReceipt => response.send(txReceipt)
            
        ).catch(()=>response.send({err:'No tx with such id'}))


    }else response.send({err:'Route is off'})

})




FASTIFY_SERVER.get('/pool_stats/:poolID',async(request,response)=>{


    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.POOL_STATS){

        // Take the info related to pool based on data in VT(verification thread) and AT(approvement thread)

        let poolOriginShard = await getFromState(`${request.params.poolID}(POOL)_POINTER`)

        let poolMetadataFromState = await getFromState(`${poolOriginShard}:${request.params.poolID}(POOL)`)

        let poolStorageFromState = await getFromState(`${poolOriginShard}:${request.params.poolID}(POOL)_STORAGE_POOL`)

        let poolStorageFromApprovementThread = await getFromApprovementThreadState(`${request.params.poolID}(POOL)_STORAGE_POOL`)


        response

            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.POOL_STATS)
        
            .send({poolMetadataFromState, poolStorageFromState, poolStorageFromApprovementThread})

            
    }else response.send({err:'Trigger is off'})

})



/*

    API endpoint that is used for searchbar in explorer and useful for general purpose queries

    Supported filters:

        + block - to get block by ID or SID
        + account - to get info about EOA account or contract by id in format <shard>:<id>
        + txid - to get info about transaction by TXID
        + epoch - to get info about epoch by epoch full id (format <epoch_hash>#<epoch_index>)
        + pool - to get info about pool by id (format <pool_pubkey>(POOL))
        + storage - to get the key/value storage of some contract. Format (<shard>:<id>_STORAGE_<id>)

*/
FASTIFY_SERVER.get('/search_result/:filter/:to_find',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.SEARCH_RESULT){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.SEARCH_RESULT}`)
            

        let searchFilter = request.params.filter

        let searchId = request.params.to_find

        let responseData

        if(searchFilter === 'block'){

            // searchId might be BlockID(in format epochIndex:poolCreator:index) or SID(in format shardID:index)

            let blockById = await BLOCKCHAIN_DATABASES.BLOCKS.get(searchId).catch(() => null)

            let block, blockId

            if(blockById){

                blockId = searchId

                block = blockById

            } else {

                block = await BLOCKCHAIN_DATABASES.STATE.get(`SID:${searchId}`).then(blockID => {

                    blockId = blockID
    
                    return BLOCKCHAIN_DATABASES.BLOCKS.get(blockID)
    
                }).catch(()=>null)

            }


            if(block){

                // Find AFP to show finalization status of block

                let aggregatedFinalizationProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+blockId).catch(()=>null)

                responseData = {block, aggregatedFinalizationProof}

            }

            // Response with block + AFP(if exists) + 

        } else if (searchFilter === 'account'){


        } else if (searchFilter === 'txid'){

            
        } else if (searchFilter === 'epoch'){

            
        } else if (searchFilter === 'pool'){

            
        } else if (searchFilter === 'storage'){

            
        } else responseData = {err:`Filter ${searchFilter} not supported`}

        
        let possibleTxReceipt = await BLOCKCHAIN_DATABASES.STATE.get('TX:'+searchFilter).then(receipt=>{

            responseData='TX_RECEIPT'

            return receipt

        }).catch(()=>false)


        if(possibleTxReceipt){

            response.send({responseType: responseData,data:possibleTxReceipt})

            return

        }
        
    
        let possibleBlock = await BLOCKCHAIN_DATABASES.BLOCKS.get(searchFilter).then(block=>{

            responseData='BLOCK_BY_ID'

            return block

        }).catch(()=>false)


        if(possibleBlock){

            response.send({responseType: responseData,data:possibleBlock})

            return

        }

            
        let possibleFromState = await BLOCKCHAIN_DATABASES.STATE.get(searchFilter).then(stateCell=>{

            responseData='FROM_STATE'

            return stateCell

        }).catch(()=>false)


        
        if(possibleFromState){

            response.send({responseType: responseData,data:possibleFromState})

            return

        }


        let epochFullID = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.hash+"#"+WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.id

        let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

        if(!currentEpochMetadata){

            response.send({responseType:'ERROR',data:'Wait for a next epoch'})

            return

        }else{

            let possibleAggregatedFinalizationProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(searchFilter).then(aggregatedFinalizationProof=>{

                responseData = searchFilter.startsWith('AFP') && 'AGGREGATED_FINALIZATION_PROOF'

                return aggregatedFinalizationProof

            }).catch(()=>false)
    

            if(possibleAggregatedFinalizationProof){

                response.send({responseType: responseData,data:possibleAggregatedFinalizationProof})
    
                return
    
            }else response.send({responseType: responseData,data:`No data`})


        }


    }else response.send({err:'Route is off'})

})