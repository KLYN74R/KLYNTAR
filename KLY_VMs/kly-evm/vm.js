import {DefaultStateManager} from '@ethereumjs/statemanager'
import {Address,Account} from '@ethereumjs/util'
import {Transaction} from '@ethereumjs/tx'
import {Common} from '@ethereumjs/common'
import {Block} from '@ethereumjs/block'
import {Trie} from '@ethereumjs/trie'
import {LevelDB} from './LevelDB.js'
import {VM} from '@ethereumjs/vm'
import {Level} from 'level'
import Web3 from 'web3'




//_________________________________________________________ CONSTANTS POOL _________________________________________________________




// 'KLY_EVM' Contains state of EVM

// 'STATE' Contains metadata for KLY-EVM pseudochain (e.g. blocks, logs and so on)


const {

    name,
    networkId,
    chainId,
    coinbase, // this address will be set as a block creator, but all the fees will be automatically redirected to KLY env and distributed among pool stakers
    hardfork,
    gasLimitForBlock,
    blockTime

} = CONFIG.EVM


const trie = new Trie({
    
    db:new LevelDB(new Level(process.env.CHAINDATA_PATH+'/KLY_EVM')), // use own implementation. See the sources

    useKeyHashing:true

})

const common = Common.custom({name,networkId,chainId},hardfork)

const stateManager = new DefaultStateManager({trie})


// Create our VM instance
const vm = await VM.create({common,stateManager})


const web3 = new Web3()


let block = Block.fromBlockData({header:{gasLimit:gasLimitForBlock,miner:coinbase}},{common})


/*

Default block template for KLY-EVM

[+] Miner(block creator) value will be mutable
[+] Timestamp will be mutable & deterministic

P.S: BTW everything will be changable

*/
// const block = Block.fromBlockData({header:{miner:'0x0000000000000000000000000000000000000000',timestamp:133713371337}},{common})


//_________________________________________________________ EXPORT SECTION _________________________________________________________




export let KLY_EVM = {


    /**
     * ### Execute tx in KLY-EVM
     * 
     * @param {string} serializedEVMTxWith0x - EVM signed tx in hexadecimal to be executed in EVM in context of given block
     * 
     * @returns txResult 
     * 
     */
    callEVM:async serializedEVMTxWith0x=>{

        
        let serializedEVMTxWithout0x = serializedEVMTxWith0x.slice(2) // delete 0x

        let tx = Transaction.fromSerializedTx(Buffer.from(serializedEVMTxWithout0x,'hex'))

        let txResult = await vm.runTx({tx,block})


        // We'll need full result to store logs and so on
        if(!txResult.execResult.exceptionError) return txResult


    },

     /**
     * ### Execute tx in KLY-EVM without state changes
     * 
     * @param {string} serializedEVMTxWith0x - EVM signed tx in hexadecimal to be executed in EVM in context of given block
     * 
     * @returns {string} result of executed contract / default tx
     */
    sandboxCall:async serializedEVMTxWith0x=>{

        
        let serializedEVMTxWithout0x = serializedEVMTxWith0x.slice(2) // delete 0x

        let tx = Transaction.fromSerializedTx(Buffer.from(serializedEVMTxWithout0x,'hex'))

        let origin = tx.getSenderAddress()
    
        let {to,data,value,gasLimit} = tx



        if(tx.validate() && tx.verifySignature()){

            let account = await vm.stateManager.getAccount(origin)

            if(account.nonce === tx.nonce && account.balance >= value){

                let txResult = await vm.evm.runCall({
        
                    origin,to,data,gasLimit,
                
                    block
                  
                })

                return txResult.execResult.exceptionError || web3.utils.toHex(txResult.execResult.returnValue)
                
            } return {error:{msg:'Wrong nonce value or insufficient balance'}}

        } return {error:{msg:'Transaction validation failed. Make sure signature is ok and required amount of gas is set'}}
    
    },

     /**
     * 
     * ### Add the account to storage
     * 
     * @param {string} address - EVM-compatible 20-bytes address
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
        
        let status = await vm.stateManager.putAccount(Address.fromString(address),Account.fromAccountData(accountData)).then(()=>({status:true})).catch(_=>({status:false}))


        return status

    },




    putContract:async(address,balanceInEthKly,nonce,code,storage)=>{

        let accountData = {
            
            nonce,
            
            balance:BigInt(balanceInEthKly) * (BigInt(10) ** BigInt(18)), // balanceInEthKly * 1 eth. So, if you want to set balance to X KLY on KLY-EVM - set parameter value to X
          
        }

        address = Address.fromString(address)
    
        await vm.stateManager.putAccount(address,Account.fromAccountData(accountData))

        for (const [key, val] of Object.entries(storage)) {
        
            const storageKey = Buffer.from(key,'hex')
            const storageVal = Buffer.from(val,'hex')
        
            await vm.stateManager.putContractStorage(address,storageKey,storageVal)
        
        }

        const codeBuf = Buffer.from(code,'hex')
    
        await vm.stateManager.putContractCode(address,codeBuf)
        
    },


    
    /**
     * 
     * ### Returns the state of account related to address
     * 
     * @param {string} address - EVM-compatible 20-bytes address
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
     * @returns {string} root of state of KLY-EVM in hexadecimal  
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
    setStateRoot: stateRootInHex => stateManager.setStateRoot(Buffer.from(stateRootInHex,'hex')),


    //____________________________________ Auxiliary functionality ____________________________________


    /**
     * 
     * ### Get the gas required for VM execution
     * 
     * @param {import('@ethereumjs/tx').TxData} txData - EVM-like transaction with fields like from,to,value,data,etc.
     *
     * @param {BigInt} timestamp - timestamp in seconds for pseudo-chain sequence
     * 
     * 
     * @returns {string} required number of gas to deploy contract or call method
     *  
    */
    estimateGasUsed:async (txData,timestamp) => {
        
        let block = Block.fromBlockData({header:{gasLimit:gasLimitForBlock,miner:coinbase,timestamp}},{common})

        let tx = Transaction.fromTxData(txData)

        let origin = tx.getSenderAddress()
        
        let {to,data} = tx
        
        let txResult = await vm.evm.runCall({
        
            origin,to,data,
        
            block
          
        })
        
        return txResult.execResult.exceptionError || web3.utils.toHex(txResult.execResult.executionGasUsed)

    },

    /**
     * 
     * @returns {Block} the current block that used on VT
     */
    getCurrentBlock:()=>block,


    setCurrentBlockParams:(nextIndex,timestamp,parentHash)=>{

        block = Block.fromBlockData({
            
            header:{

                gasLimit:gasLimitForBlock,
                miner:coinbase,
                timestamp,
                parentHash:Buffer.from(parentHash,'hex'),
                number:nextIndex
            
            }
        
        },{common})

    }

}




global.KLY_EVM = KLY_EVM