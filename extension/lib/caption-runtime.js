import {SendRequest} from './ui.js';
import {InstallCaptionHelper} from './caption-installer.js';
import {CaptionRuntimeReady} from './caption-runtime-contract.js';

let Updating;
/** The extension supplies and versions the runtime; the OS helper only installs it. */
export async function EnsureCaptionRuntime(Platform,Engine,OnState=()=>{}){
 const Probe=Options=>SendRequest('captionProbe',Options);
 let Result;try{Result=await Probe({engine:Engine,model:''});}catch{}
 if(CaptionRuntimeReady(Result))return Result;
 Updating??=InstallCaptionHelper(Platform,Probe,OnState).finally(()=>{Updating=undefined;});await Updating;
 Result=await Probe({engine:Engine,model:''});if(!CaptionRuntimeReady(Result))throw Error('caption_helper_update_required');return Result;
}
