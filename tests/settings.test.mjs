import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { GetSetting, GetSettings, OnSettingChanged, SetDownloadLocation, SetSetting, SettingKeys } from '../extension/lib/settings.js';
Test('automatic YouTube captions default included and persist an explicit false only as boolean',async T=>{
	const Values={};globalThis.chrome={storage:{local:{get:async()=>Values,set:async V=>Object.assign(Values,V)}}};T.after(()=>delete globalThis.chrome);
	Assert.equal(await GetSetting(SettingKeys.includeYoutubeAutoCaptions),true);
	await SetSetting(SettingKeys.includeYoutubeAutoCaptions,false);Assert.equal(await GetSetting(SettingKeys.includeYoutubeAutoCaptions),false);
	await Assert.rejects(SetSetting(SettingKeys.includeYoutubeAutoCaptions,'false'),TypeError);
});
Test('normalizes existing preference values and keeps their storage keys', async T =>
{
	const Records = { debugDownloads: 'true', chooseHlsQuality: true, downloadFolder: ' Videos\\HLS\\ ', language: 'es' };
	const Reads = [];
	globalThis.chrome = { storage: { local: {
				async get(Keys)
				{
					Reads.push(Keys);
					const List = Array.isArray(Keys) ? Keys : [Keys];
					return Object.fromEntries(List.map(Key => [Key, Records[Key]]));
				},
				async set(Changes)
				{
					Object.assign(Records, Changes);
				},
			} } };
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Keys = Object.values(SettingKeys);
	Assert.deepEqual(await GetSettings(Keys), {
		debugLogging: false, debugDownloads: false, logDownloads: false, includeYoutubeAutoCaptions: true, showPanelMedia: false, usePageTitle: true, useDownloadDateTime: true,
		downloadFolder: 'Videos/HLS', pickedDownloadFolder: '', language: 'es',
	});
	Assert.deepEqual(Reads, [Keys]);
	Assert.equal(await GetSetting(SettingKeys.usePageTitle), true);
	Assert.equal(Reads[1], 'usePageTitle');
	await SetSetting(SettingKeys.downloadFolder, ' New\\Folder\\ ');
	Assert.equal(Records.downloadFolder, 'New/Folder');
	Assert.equal(Records.language, 'es');
	await Assert.rejects(SetSetting(SettingKeys.downloadFolder, '../invalid'), TypeError);
	Assert.equal(Records.downloadFolder, 'New/Folder');
	Object.assign(Records, { usePageTitle: false, useDownloadDateTime: false, downloadFolder: '../invalid', language: '../../es' });
	Assert.deepEqual(await GetSettings(Keys), {
		debugLogging: false, debugDownloads: false, logDownloads: false, includeYoutubeAutoCaptions: true, showPanelMedia: false, usePageTitle: false, useDownloadDateTime: false,
		downloadFolder: '', pickedDownloadFolder: '', language: 'auto',
	});
});
Test('commits the chosen folder or typed path in one settings update', async T =>
{
	const Writes = [];
	const FolderId = '01234567-89ab-cdef-0123-456789abcdef';
	globalThis.chrome = { storage: { local: { async set(Values)
				{
					Writes.push(Values);
				} } } };
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await SetDownloadLocation('', FolderId);
	await Assert.rejects(SetDownloadLocation('../outside'), TypeError);
	await SetDownloadLocation('New\\Folder');
	Assert.deepEqual(Writes, [
		{ downloadFolder: '', pickedDownloadFolder: FolderId },
		{ downloadFolder: 'New/Folder', pickedDownloadFolder: '' },
	]);
});
Test('observes only the selected local preference, including removal', T =>
{
	let Notify;
	let ChangesSeen = 0;
	globalThis.chrome = { storage: { onChanged: { addListener(Listener)
				{
					Notify = Listener;
				} } } };
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	OnSettingChanged(SettingKeys.language, () =>
	{
		ChangesSeen++;
	});
	Notify({ language: { newValue: 'ja' } }, 'sync');
	Notify({ unrelated: { newValue: 'ja' } }, 'local');
	Assert.equal(ChangesSeen, 0);
	Notify({ language: { newValue: 'ja' } }, 'local');
	Notify({ language: { oldValue: 'ja' } }, 'local');
	Assert.equal(ChangesSeen, 2);
});
