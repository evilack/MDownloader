import {CreatePreviewServer} from '../../website/serve.mjs';
import {fileURLToPath} from 'node:url';
const Server=CreatePreviewServer({root:fileURLToPath(new URL('../../',import.meta.url))});
Server.listen(0,'127.0.0.1',()=>console.log('LOCAL_CAPTIONS_PREVIEW=http://127.0.0.1:'+Server.address().port+'/tools/dev/local-captions-preview.html'));
