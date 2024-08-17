import {customLog, logColors, getUtcTimestamp} from '../../KLY_Utils/utils.js'

import {NODE_METADATA, WORKING_THREADS} from './blockchain_preparation.js'

import {BLOCKCHAIN_GENESIS, CONFIGURATION} from '../../klyn74r.js'

import cryptoModule from 'crypto'

import readline from 'readline'







export let heapSort = arr => {

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

}




export let getRandomFromArray = arr => {

    let randomIndex = Math.floor(Math.random() * arr.length)
  
    return arr[randomIndex]

}




export let getAllKnownPeers=()=>[...CONFIGURATION.NODE_LEVEL.BOOTSTRAP_NODES,...NODE_METADATA.PEERS]




// NODE_METADATA.CORE_MAJOR_VERSION shows the major version of your node(core)
// We use this function on VERIFICATION_THREAD and APPROVEMENT_THREAD to make sure we can continue to work
// If major version was changed and we still has an old version - we should stop node and update software
export let isMyCoreVersionOld = threadID => WORKING_THREADS[threadID].CORE_MAJOR_VERSION > NODE_METADATA.CORE_MAJOR_VERSION




export let epochStillFresh = thread => thread.EPOCH.startTimestamp + thread.NETWORK_PARAMETERS.EPOCH_TIME > getUtcTimestamp()




export let decryptKeys=async()=>{
    
    let readLineInterface = readline.createInterface({input: process.stdin,output: process.stdout,terminal:false})


    customLog(`Blockchain info \x1b[32;1m(\x1b[36;1mworkflow:${BLOCKCHAIN_GENESIS.NETWORK_WORKFLOW}[AT major version:${NODE_METADATA.CORE_MAJOR_VERSION}] / your pubkey:${CONFIGURATION.NODE_LEVEL.PUBLIC_KEY}\x1b[32;1m)`,logColors.CYAN)


    
    let hexSeed = await new Promise(resolve=>
        
        readLineInterface.question(`\n ${logColors.TIME_COLOR}[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})${logColors.CLEAR}  Enter \x1b[32mpassword\x1b[0m to decrypt private key in memory of process ———> \x1b[31m`,resolve)
        
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












//_______________________ Local(non-exported) functions _______________________



let swap = (arr, firstItemIndex, lastItemIndex) => {
    
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
  
}