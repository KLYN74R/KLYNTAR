import {BLAKE3} from '../KLY_Space/utils.js'

export default class ControllerBlock{
    
    constructor(chain,instantBlocksArr){
        
        this.c=CONFIG.CHAINS[chain].PUB
        
        this.a=instantBlocksArr//array of InstantBlocks' hashes
        
        this.i=QUANT_CONTROL[chain].NEXT_INDEX//index of block.Need for indexation in DB only
        
        this.p=QUANT_CONTROL[chain].GENERATED_PREV_HASH
        
        this.sig=''
    
    }
    
    static genHash=(chain,instantArray,index,prevHash)=>BLAKE3( JSON.stringify(instantArray) + chain + index + prevHash)

}