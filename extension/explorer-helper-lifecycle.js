import {ReceiveExplorerRemoval,ReadExplorerInstallation} from './lib/explorer-lifecycle.js';
const Query=new URLSearchParams(location.search),Event=Query.get('event'),Token=Query.get('token');
history.replaceState(null,'',location.pathname);
try{
	if(Event==='removed')await ReceiveExplorerRemoval(Token);
	else if(Event==='installed')await ReadExplorerInstallation();
}finally{
	const Tab=await chrome.tabs.getCurrent();if(Tab?.id!==undefined)await chrome.tabs.remove(Tab.id);
}
