import {GET_FROM_STATE,GET_FROM_STATE_FOR_QUORUM_THREAD,VERIFY} from './utils.js'

import bls from '../../KLY_Utils/signatures/multisig/bls.js'




export default {

    /*
    
        {

            V:CONFIG.SYMBIOTE.PUB, //AwakeMessage issuer(validator who want to activate his thread again)
                   
            P:aggregatedPub, //Approver's aggregated BLS pubkey

            S:aggregatedSignatures,

            H:myMetadataHash,

            A:[] //AFK validators who hadn't vote. Need to agregate it to the ROOT_VALIDATORS_KEYS
            
        }
    
    */

    AWAKE:async(messagePayload,notJustOverview)=>{

        let aggregatedValidatorsPublicKey = SYMBIOTE_META.STUFF_CACHE.get('QUORUM_AGGREGATED_PUB') || bls.aggregatePublicKeys(SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM),

            rootPub = bls.aggregatePublicKeys([...messagePayload.A,messagePayload]),

            quorumSize=SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.length,

            majority = Math.floor(quorumSize*(2/3))+1


        //Check if majority is not bigger than number of validators. It possible when there is small number of validators

        majority = majority > quorumSize ? quorumSize : majority
            
        let isMajority = ((SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.length-messagePayload.A.length)>=majority)


        if(aggregatedValidatorsPublicKey === rootPub && SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.includes(messagePayload.V) && await VERIFY(messagePayload.H,messagePayload.S,messagePayload.P) && isMajority){

            if(notJustOverview){

                //Change the state

                //Make active to turn back this validator's thread to VERIFICATION_THREAD
                SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[messagePayload.V].FREEZED=false
                
                //And increase index to avoid confusion
                SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[messagePayload.V].INDEX++

            } else return true
                
        }

    },


    //______________________________ FUNCTIONS TO PROCESS <OPERATIONS> IN CHECKPOINTS ______________________________

    /*
    
    We need to do this ops on/via checkpoints in order to make threads async
    
    */


    //Function to move stakes between pool <=> waiting room of pool
    STAKING_CONTRACT_CALL:async (payload,isFromRoute,usedOnQuorumThread)=>{

    /*
    
        Full

        {
            type:'STAKING_CONTRACT_CALL',
            payload
        }

        Structure of payload

        {
            txid:<id in WAITING_ROOM in contract storage>,
            pool:<BLS pubkey of pool>,
            type:<'-' for unstake and '+' for stake>
            amount:<integer> - staking power in UNO
        }
    
        Also, we check if operation in WAITING_ROOM still valid(timestamp is not so old).

    
    */

        let {txid,pool,type,amount}=payload


        if(isFromRoute && txid!=='QT'){

            //To check payload received from route

            let poolStorage = await SYMBIOTE_META.STATE.get(pool+'(POOL)_STORAGE_POOL').catch(_=>false)

            if(poolStorage){

                let overviewIsOk = 
                
                    poolStorage.WAITING_ROOM[txid] // Check if in WAITING_ROOM on VERIFICATION_THREAD
                    &&
                    SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.TIMESTAMP - poolStorage.WAITING_ROOM[txid].timestamp <= CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.WAITING_ROOM_MAX_TIME // If it's still valid
                    &&
                    !(await SYMBIOTE_META.QUORUM_THREAD_METADATA.get(txid).catch(_=>true)) //...and finally if it's still unspent


                return overviewIsOk               

            }

        }
        else if(usedOnQuorumThread){

            // Basic ops on QUORUM_THREAD

            let poolStorageOfQT = await GET_FROM_STATE_FOR_QUORUM_THREAD(pool),
            
                possibleSpentTx = await GET_FROM_STATE_FOR_QUORUM_THREAD(txid)

            /* 
            
            poolStorageOfQT is

                {
                    totalPower:<number>
                    isStopped:<boolean>
                    stopTimestamp:<number>
                    storedMetadata:{INDEX,HASH}
                }
            
            */

            let overviewIsOk = 
            
                poolStorageOfQT // Pool exists
                &&
                (!poolStorageOfQT.isStopped || SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.TIMESTAMP - poolStorageOfQT.stopTimestamp <= CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.POOL_AFK_MAX_TIME) // If stopped - check if still can be resurrected
                &&
                !possibleSpentTx //...and finally if it's still unspent


            if(overviewIsOk){

                //If everything is ok - add or slash totalPower of the pool

                if(type==='+') poolStorageOfQT.totalPower+=amount
                
                else poolStorageOfQT.totalPower-=amount

                //Put to cache that this tx was spent
                SYMBIOTE_META.QUORUM_THREAD_CACHE.set(txid,true)
    
            }
        
        }
        else{

            /*
            
            Logic on VERIFICATION_THREAD
            
            Here we should move stakers from WAITING_ROOMs to stakers

            Also, recount the pool total power and check if record in WAITING_ROOM is still valid(check it via .timestamp property and compare to timestamp of current checkpoint on VT)

            Then, delete record from WAITING_ROOM and add to "stakers"


            Struct in POOL.WAITING_ROOM

                {

                    timestamp:SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP,

                    staker:event.creator,

                    amount,

                    units,

                    type:'+' //means "STAKE" or "-" for "UNSTAKE"
                        
                }

            Struct in POOL.STAKERS

            PUBKEY => {KLY,UNO,REWARD}
            
            */

            let poolStorage = await GET_FROM_STATE(pool+'(POOL)_STORAGE_POOL')

            //Check if record exists
            if(poolStorage && poolStorage.WAITING_ROOM[txid]){

                let queryFromWaitingRoom = poolStorage.WAITING_ROOM[txid],
                
                    stakerAccount = poolStorage.STAKERS[queryFromWaitingRoom.staker] || {KLY:0,UNO:0,REWARD:0}

                /*

                    queryFromWaitingRoom has the following structure

                    {

                        timestamp:SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP,

                        staker:event.creator,

                        amount,

                        units,

                        type:'+' //means "STAKE" or "-" for "UNSTAKE"
                        
                    }

                
                */

                //If record is too old - don't move it from WAITING_ROOM
                if(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP - queryFromWaitingRoom.timestamp > CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.WAITING_ROOM_MAX_TIME) return

                //Count the power of this operation
                let extraPower = queryFromWaitingRoom.units==='UNO' ? queryFromWaitingRoom.amount : queryFromWaitingRoom.amount * CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.KLY_UNO_RATIO

                //Check if we still don't overstake
                if(poolStorage.totalPower+poolStorage.overStake < poolStorage.totalPower+extraPower) return

                if(queryFromWaitingRoom.type==='+'){

                    stakerAccount[queryFromWaitingRoom.units]+=queryFromWaitingRoom.amount

                    poolStorage.totalPower+=extraPower

                }else {

                    stakerAccount[queryFromWaitingRoom.units]-=queryFromWaitingRoom.amount

                    poolStorage.totalPower-=extraPower

                }

                //Assign updated state
                poolStorage.STAKERS[queryFromWaitingRoom.staker]=stakerAccount

                //Remove from WAITING_ROOM

                delete poolStorage.WAITING_ROOM[txid]


                if(poolStorage.totalPower>=CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.VALIDATOR_STAKE){

                    //Add to SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS and VALIDATORS_METADATA with the default empty template

                    SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.push(pool)

                    SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[pool]={
                        
                        INDEX:-1,
                    
                        HASH:'Poyekhali!@Y.A.Gagarin',
                    
                        FREEZED:false
                    
                    }

                }
                
            }
        
        }

    },

    //To freeze/unfreeze validators in pool(to skip their thread during VERIFICATION_THREAD)
    FREEZING:async (payload,isJustVerify)=>{

        

    },

    //To make updates of workflow(e.g. version change, WORKFLOW_OPTIONS changes and so on)
    WORKFLOW_UPDATE:async (payload,isJustVerify)=>{}

}