import {DefaultStateManager} from '@ethereumjs/statemanager'
import {Address,Account} from '@ethereumjs/util'
import {Transaction} from '@ethereumjs/tx'
import {Common} from '@ethereumjs/common'
import {Block} from '@ethereumjs/block'
import {Trie} from '@ethereumjs/trie'
import {LevelDB} from './LevelDB.js'
import {VM} from '@ethereumjs/vm'
import {Level} from 'level'




//_________________________________________________________ CONSTANTS POOL _________________________________________________________



//'KLY_EVM' Contains state of EVM

//'KLY_EVM_META' Contains metadata for KLY-EVM pseudochain (e.g. blocks, logs and so on)

const trie = new Trie({
    
    db:new LevelDB(new Level(process.env.CHAINDATA_PATH+'/KLY_EVM')), // use own implementation. See the sources

    useKeyHashing:true

})

const common = Common.custom({name:'KLYNTAR',networkId:7331,chainId:7331},'london') //set to MERGE

const stateManager = new DefaultStateManager({trie})


// Create our VM instance
const vm = await VM.create({common,stateManager})


/*

Default block template for KLY-EVM

[+] Miner(block creator) value will be mutable
[+] Timestamp will be mutable & deterministic

P.S: BTW everything will be changable

*/
const block = Block.fromBlockData({header:{miner:'0x0000000000000000000000000000000000000000',timestamp:133713371337}},{common})




//_________________________________________________________ EXPORT SECTION _________________________________________________________




export let KLY_EVM = {


    /**
     * ### Execute tx in KLY-EVM
     * 
     * @param {String} serializedEVMTx - EVM signed tx in hexadecimal to be executed in EVM in context of given block
     * @param {Block} block - blocks to execute tx in this context
     * 
     * @returns txResult 
     */
    callContract:async(serializedEVMTx,block)=>{

        let tx = Transaction.fromSerializedTx(serializedEVMTx)

        let txResult = await vm.runTx({tx,block}).catch(error=>error)

        return txResult

    },

     /**
     * ### Execute tx in KLY-EVM without state changes
     * 
     * @param {String} serializedEVMTx - EVM signed tx in hexadecimal to be executed in EVM in context of given block
     * @param {Block} block - blocks to execute tx in this context
     * 
     * @returns txResult 
     */
    sandboxCall:async(tx,block)=>{

        let txResult = await vm.evm.runCall({tx,block}).catch(error=>error)

        return txResult

    },

     /**
     * 
     * ### Add the account to storage
     * 
     * @param {String} address - EVM-compatible 20-bytes address
     * @param {number} balanceInEthKly - wished balance
     * @param {number} nonce - account nonce
     * 
     * 
     * @returns {Object} result - The execution status 
     * @returns {boolean} result.status
     * 
     */
    putAccount:async(address,balanceInEthKly,nonce=0)=>{

        let accountData = {
            
            nonce,
            
            balance: BigInt(balanceInEthKly) * (BigInt(10) ** BigInt(18)), // balanceInEthKly * 1 eth. So, if you want to set balance to X KLY on KLY-EVM - set parameter value to X
          
        }
        
        let status = await vm.stateManager.putAccount(Address.fromString(address),Account.fromAccountData(accountData)).then(()=>({status:true})).catch(_=>{

            console.log(_)

            return {status:false}
        })

        return status

    },

    /**
     * 
     * ### Returns the state of account related to address
     * 
     * @param {String} address - EVM-compatible 20-bytes address
     * 
     * @returns {Object} account - The account from state 
     * 
     * @returns {BigInt} account.nonce
     * @returns {BigInt} account.balance
     * @returns {Buffer} account.storageRoot
     * @returns {Buffer} account.codeHash
     * @returns {boolean} account.virtual
     * 
     * 
     */
    getAccount:async address => vm.stateManager.getAccount(Address.fromString(address)),

    /**
     * 
     * ### Returns the root of VM state
     * 
     * @returns {String} root of state of KLY-EVM in hexadecimal  
     * 
     */
    getStateRoot:async()=>{

        let stateRoot = await vm.stateManager.getStateRoot()
        
        return stateRoot.toString('hex') //32-bytes hexadecimal form

    },


    /**
     * 
     * ### Set the root of VM state
     * 
     * @param {string} 32-bytes hexadecimal root of VM's state
     * 
     */
    setStateRoot: stateRootInHex => stateManager.setStateRoot(Buffer.from(stateRootInHex,'hex'))


    //____________________________________ Auxiliary functionality ____________________________________



}