import {CreateElement} from './lib/ui.js';
import {Translate} from './lib/i18n.js';
import {StatusMessages} from './lib/subtitle-status.js';
export function CreateSubtitleStatus(Status)
{
 const Node=CreateElement('div','','subtitle-status');
 UpdateSubtitleStatus(Node,Status); return Node;
}
export function UpdateSubtitleStatus(Node,Status)
{
 const Messages=StatusMessages(Status);
 Node.replaceChildren(...Messages.map(([Key,Value])=>CreateElement('span',Translate(Key,Value))));
 Node.hidden=Messages.length===0;
 Node.dataset.phase=Status?.phase || 'unknown';
 Node.dataset.failed=String(Status?.phase==='failed' || Status?.translation==='failed');
 Node.title=Status?.languages?.join(', ') || '';
}
