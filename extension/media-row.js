/** Shared title/metadata/end layout for candidates and persisted downloads. */
import {CreateElement} from './lib/ui.js';

export function CreateMediaRow({kind, thumbnail, heading, metadata, measure, actions})
{
 const Row=CreateElement('li','',`${kind} media-row`);
 const Top=CreateElement('div','','media-row-top');
 const Description=CreateElement('div','','media-row-description');
 const End=CreateElement('div','','media-row-end');
 Description.append(heading,metadata);
 End.append(measure,actions);
 Top.append(thumbnail,Description,End);
 Row.append(Top);
 return {row:Row,top:Top,description:Description,end:End};
}

const MetadataSignatures = new WeakMap();

export function UpdateRowMetadata(Node, Items)
{
 const Signature=JSON.stringify(Items.map(Item=>[Item.text,!!Item.failed,!!Item.working]));
 if(MetadataSignatures.get(Node)===Signature) return;
 Node.replaceChildren(...Items.map(Item=>{
  const Part=CreateElement('span',Item.text,Item.failed?'metadata-failed':Item.working?'metadata-working':'');
  Part.lang='en';
  return Part;
 }));
 Node.dataset.failed=String(Items.some(Item=>Item.failed));
 Node.hidden=Items.length===0;
 MetadataSignatures.set(Node,Signature);
}
