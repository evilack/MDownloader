import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {PreviewTile} from '../extension/media-thumbnails.js';

function TileEnvironment(T, Load = async()=>({}))
{
	class Node extends EventTarget
	{
		constructor(){super();this.children=[];}
		append(...Items){this.children.push(...Items);}
		setAttribute(){}
		removeAttribute(Key){delete this[Key];}
	}
	globalThis.document={createElement:()=>new Node()};
	globalThis.Image=class extends Node{};
	T.after(()=>{delete globalThis.document;delete globalThis.Image;});
	let ReadHover;
	const Tile=PreviewTile({attach(_Control,Read){ReadHover=Read;}},Load);
	return {tile:Tile,hover:Signal=>ReadHover(Signal),
		duration:Tile.control.children.find(Node=>Node.className==='candidate-preview-duration'),
		resolution:Tile.control.children.find(Node=>Node.className==='candidate-preview-resolution')};
}

Test('late thumbnail refresh respects the latest scheduled waiting presentation',async T=>
{
	const {tile,duration,resolution}=TileEnvironment(T),Read=Promise.withResolvers();
	const Refresh=tile.refresh(()=>Read.promise);
	tile.setPresentation?.({suppressPreview:true});
	Read.resolve({duration:120,resolution:{width:1280,height:720}});await Refresh;
	Assert.equal(duration.hidden,true);Assert.equal(resolution.hidden,true);
});

Test('clearing suppression restores the latest real finite duration and resolution',async T=>
{
	const {tile,duration,resolution}=TileEnvironment(T);
	await tile.show({duration:120,resolution:{width:1280,height:720}});
	tile.setPresentation?.({suppressPreview:true});
	Assert.equal(duration.hidden,true);Assert.equal(resolution.hidden,true);
	await tile.show({duration:180,resolution:{width:1920,height:1080}});
	tile.setPresentation?.({suppressPreview:false});
	Assert.equal(duration.textContent,'00:03:00');Assert.equal(duration.hidden,false);
	Assert.equal(resolution.textContent,'1920×1080');Assert.equal(resolution.hidden,false);
});

Test('live elapsed persists across thumbnail refreshes and empty elapsed never shows a total duration',async T=>
{
	const {tile,duration}=TileEnvironment(T);
	tile.setPresentation?.({elapsed:'00:02:13',live:true});
	await tile.refresh(async()=>({duration:5400,resolution:{width:1280,height:720}}));
	Assert.equal(duration.textContent,'00:02:13');Assert.equal(duration.hidden,false);
	tile.setPresentation?.({elapsed:'',live:true});
	Assert.equal(duration.hidden,true);
	tile.setPresentation?.({elapsed:'00:02:15',live:true});
	await tile.show({duration:5500});
	Assert.equal(duration.textContent,'00:02:15');Assert.equal(duration.hidden,false);
});

Test('late hover source resolution cannot reveal facts suppressed while loading',async T=>
{
	const Read=Promise.withResolvers(),{tile,hover,resolution}=TileEnvironment(T,()=>Read.promise);
	const Pending=hover(new AbortController().signal);
	tile.setPresentation?.({suppressPreview:true});
	Read.resolve({resolution:{width:1920,height:1080}});await Pending;
	Assert.equal(resolution.hidden,true);
	tile.setPresentation?.({suppressPreview:false});
	Assert.equal(resolution.hidden,false);Assert.equal(resolution.textContent,'1920×1080');
});
