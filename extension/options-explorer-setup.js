import {EnsureHelperForFeature} from './options-helper-navigation.js';

/** Installation is managed only in the Helper category. */
export async function BeforePickDownloadFolder()
{
 return EnsureHelperForFeature({feature:'folder'});
}
