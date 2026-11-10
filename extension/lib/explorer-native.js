import {LocalizedError} from './i18n.js';
export const ExplorerHost='com.mdownloader.explorer';
export function RequestExplorer(Message){
	return new Promise((Resolve,Reject)=>{
		let Port,Done=false,Timer;
		const Finish=(ErrorValue,Result)=>{if(Done)return;Done=true;clearTimeout(Timer);Port?.disconnect();if(ErrorValue)Reject(ErrorValue);else Resolve(Result);};
		const Failure=Reason=>{const ErrorValue=new LocalizedError(/not found|not registered|forbidden|permission/i.test(Reason)?'explorer_bridge_required':'explorer_reveal_failed');ErrorValue.reason=/not found|not registered/i.test(Reason)?'missing':/forbidden|permission|not allowed/i.test(Reason)?'permission':Reason==='native timeout'?'timeout':'unavailable';return ErrorValue;};
		Timer=setTimeout(()=>Finish(Failure('native timeout')),15000);
		try{Port=chrome.runtime.connectNative(ExplorerHost);Port.onMessage.addListener(Result=>Finish(null,Result));Port.onDisconnect.addListener(()=>Finish(Failure(chrome.runtime.lastError?.message??'')));Port.postMessage(Message);}catch(ErrorValue){Finish(Failure(ErrorValue?.message??''));}
	});
}
