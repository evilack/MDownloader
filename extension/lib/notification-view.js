export const NotificationViewPort='mdownloader-notification-view';
export const NotificationViewRefresh='mdownloader-notification-refresh';
/** A live toolbar-popup connection represents items; ordinary tabs never register. */
export function CreateNotificationView(){
	if(!chrome.extension.getViews({type:'popup'}).includes(window))return()=>{};
	let RequestIds=[],Signature,Port,Serial=0;const Pending=new Map();
	function Connect(){
		if(Port)return;Port=chrome.runtime.connect({name:NotificationViewPort});
		Port.onMessage.addListener(M=>{const Done=Pending.get(M.ack);if(Done){Pending.delete(M.ack);Done(true);}});
		Port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;Port=null;Signature=undefined;for(const Done of Pending.values())Done(false);Pending.clear();});
	}
	function Publish(Force=false){
		const State={visible:!document.hidden,requestIds:RequestIds};
		const Next=JSON.stringify(State);if(!Force&&Next===Signature&&Port)return Promise.resolve(true);Signature=Next;
		try{Connect();const Id=++Serial;return new Promise(Resolve=>{
			const Timer=setTimeout(()=>{Pending.delete(Id);Signature=undefined;Resolve(false);},600);
			Pending.set(Id,Ok=>{clearTimeout(Timer);Resolve(Ok);});
			try{Port.postMessage({...State,serial:Id});}catch{Pending.get(Id)?.(false);Pending.delete(Id);Signature=undefined;}
		});}catch{Signature=undefined;return Promise.resolve(false);}
	}
	chrome.runtime.onMessage.addListener((M,Sender,Respond)=>{
		if(M.type!==NotificationViewRefresh||Sender.id!==chrome.runtime.id)return;
		void Publish(true).then(Ok=>Respond({ok:Ok}));return true;
	});
	document.addEventListener('visibilitychange',()=>void Publish());void Publish();
	return Ids=>{RequestIds=[...new Set(Ids)].sort();void Publish();};
}
