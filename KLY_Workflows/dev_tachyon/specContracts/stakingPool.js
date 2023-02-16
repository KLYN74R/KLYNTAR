import {GET_ACCOUNT_ON_SYMBIOTE,GET_FROM_STATE} from '../utils.js'

import {BLAKE3} from '../../../KLY_Utils/utils.js'




export let CONTRACT = {

    /*
    
    Used by pool creators to create contract instance and a storage "POOL"

    Payload is
    
    {
        bytecode:'',(empty)
        lang:'spec/stakingPool'
        constructorParams:[]
    }

    Required params:[BLSPoolRootKey,Percentage,OverStake,WhiteList,PoolAddress]

        [*] BLSPoolRootKey - BLS pubkey for validator. The same as PoolID
        [*] Percentage - % of fees that will be earned by BLS pubkey related to PoolID. The rest(100%-Percentage) will be shared among stakers
        [*] OverStake - number of power(in UNO) allowed to overfill the minimum stake. You need this to prevent deletion from validators pool if your stake are lower than minimum
        [*] WhiteList - array of addresses who can invest in this pool. Thanks to this, you can set own logic to distribute fees,make changes and so on by adding only one address - ID of smart contract
        [*] PoolAddress - URL in form http(s)://<domain_or_direct_ip_of_server_cloud_or_smth_like_this>:<port>/<optional_path>
        
        ------------ For reserve pools ------------

        [*] IsReserve - define type of pool. isReserve=false means that this pool will have a separate subchain. isReserve=false means that you pool will be in reserve and will be used only when main pool will be stopped
        [*] ReserveFor - SubchainID of main pool

    */
    constructor:async (event,atomicBatch,originSubchain) => {

        let{constructorParams}=event.payload,

            [blsPubKey,percentage,overStake,whiteList,poolURL,isReserve,reserveFor]=constructorParams,

            poolAlreadyExists = await SYMBIOTE_META.STATE.get(BLAKE3(originSubchain+blsPubKey+'(POOL)')).catch(_=>false)


        if(!poolAlreadyExists && overStake>=0 && Array.isArray(whiteList) && typeof poolURL === 'string'){

            let contractMetadataTemplate = {

                type:"contract",
                lang:'spec/stakingPool',
                balance:0,
                uno:0,
                storages:['POOL'],
                bytecode:''

            }

            let onlyOnePossibleStorageForStakingContract={
                
                percentage,

                overStake,

                poolURL,

                whiteList,

                isReserve,

                lackOfTotalPower:false,
                    
                stopCheckpointID:-1,
                    
                storedMetadata:{},

                totalPower:0, // KLY(converted to UNO by CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.VALIDATOR_STAKE_RATIO) + UNO. Must be greater than CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.VALIDATOR_STAKE
                
                stakers:{}, // Pubkey => {KLY,UNO,REWARD}

                waitingRoom:{} // We'll move stakes from "WAITING_ROOM" to "STAKERS" via SPEC_OPS in checkpoints

            }


            if(isReserve) onlyOnePossibleStorageForStakingContract.reserveFor=reserveFor

            
            //Put metadata
            atomicBatch.put(BLAKE3(originSubchain+blsPubKey+'(POOL)'),contractMetadataTemplate)

            //Put storage
            //NOTE: We just need a simple storage with ID="POOL"
            atomicBatch.put(BLAKE3(originSubchain+blsPubKey+'(POOL)_STORAGE_POOL'),onlyOnePossibleStorageForStakingContract)

        }

    },

    /*
     
    Method to delegate your assets to some validator | pool

    Payload

    {
        pool:<id of special contract - BLS validator's pubkey'>
        amount:<amount in KLY or UNO> | NOTE:must be int - not float
        units:<KLY|UNO>
    }
    
    */
    
    stake:async(event,originSubchain) => {

        let fullPoolIdWithPostfix=event.payload.contractID, // Format => BLS_pubkey(POOL)

            {amount,units}=event.payload.params[0],

            poolStorage = await GET_FROM_STATE(BLAKE3(originSubchain+fullPoolIdWithPostfix+'_STORAGE_POOL'))


        //Here we also need to check if pool is still not fullfilled
        //Also, instantly check if account is whitelisted

        if(poolStorage && (poolStorage.whiteList.length===0 || poolStorage.whiteList.includes(event.creator))){

            let stakerAccount = await GET_ACCOUNT_ON_SYMBIOTE(BLAKE3(originSubchain+event.creator))

            if(stakerAccount){
            
                let stakeIsOk = (units==='kly'?amount <= stakerAccount.balance:amount <= stakerAccount.uno) && amount >= SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.MINIMAL_STAKE_PER_ENTITY

                if(stakeIsOk && poolStorage.totalPower + amount <= poolStorage.overStake+SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.VALIDATOR_STAKE){

                    poolStorage.waitingRoom[BLAKE3(event.sig)]={

                        checkpointID:SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID,

                        staker:event.creator,

                        amount,

                        units,

                        type:'+' //means "STAKE"
                    
                    }

                    //Reduce number of KLY/UNO from account
                    if(units==='kly') stakerAccount.balance-=amount
                    
                    else stakerAccount.uno-=amount

                }

            }
    
        }

    },


    /*
     
        Method to delegate your assets to some validator | pool

        Payload

        {
            pool:<id of special contract - BLS validator's pubkey'>
            amount:<amount in KLY or UNO> | NOTE:must be int - not float
            type:<KLY|UNO>
        }

    
    */
    unstake:async (event,originSubchain) => {

        let fullPoolIdWithPostfix=event.payload.contractID,

            {amount,units}=event.payload.params[0],

            poolStorage = await GET_FROM_STATE(BLAKE3(originSubchain+fullPoolIdWithPostfix+'_STORAGE_POOL')),

            stakerInfo = poolStorage.stakers[event.creator], // Pubkey => {KLY,UNO,REWARD}

            wishedAmountIsOk = stakerInfo[units==='kly'?'kly':'uno'] >= amount


        if(poolStorage && wishedAmountIsOk){

            poolStorage.waitingRoom[BLAKE3(event.sig)]={

                checkpointID:SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID,

                staker:event.creator,

                amount,

                units,

                type:'-' //means "UNSTAKE"

            }
    
        }

    },



    
    /*
     
        Method to withdraw your money by staking

        Payload is PoolID(because we send instantly full reward)

    
    */
    getReward:async (event,originSubchain) => {

        let fullPoolIdWithPostfix=event.payload.contractID,

            poolStorage = await GET_FROM_STATE(BLAKE3(originSubchain+fullPoolIdWithPostfix+'_STORAGE_POOL')),

            stakerAccount = await GET_ACCOUNT_ON_SYMBIOTE(BLAKE3(originSubchain+event.creator)),

            stakerInfo = poolStorage.stakers[event.creator] // Pubkey => {KLY,UNO,REWARD}


        if(poolStorage && stakerAccount && stakerInfo.reward>0){

            stakerAccount.balance += stakerInfo.reward

            stakerInfo.reward=0

        }

    }
        
}