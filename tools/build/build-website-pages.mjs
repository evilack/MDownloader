import {cp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const Source = fileURLToPath(new URL('../../website/', import.meta.url));
const Output = resolve(process.argv[2] ?? 'artifacts/website-pages');
const {defaultVariant: DefaultVariant} = JSON.parse(await readFile(join(Source, 'homepage.json'), 'utf8'));
const Variants = ['clean', 'full'];
if (!Variants.includes(DefaultVariant))
{
	throw new Error('website/homepage.json defaultVariant must be "clean" or "full".');
}

const Templates = await Promise.all(['index.html', 'index-ko.html'].map(File => readFile(join(Source, File), 'utf8')));
const FullOnly = /<!-- full-only -->([\s\S]*?)<!-- \/full-only -->/g;
await mkdir(Output, {recursive: true});
if ((await readdir(Output)).length)
{
	throw new Error('The website output directory must be empty: ' + Output);
}
await cp(Source, Output, {
	recursive: true,
	filter: File => File !== join(Source, 'homepage.json'),
});

for (const Variant of Variants)
{
	const English = 'index-' + Variant + '.html';
	const Korean = 'index-' + Variant + '-ko.html';
	for (const [Index, Template] of Templates.entries())
	{
		const Page = Template.replace(FullOnly, Variant === 'full' ? '$1' : '');
		const FixedPage = Page
			.replace('data-page="product"', 'data-page="product-' + Variant + '"')
			.replace(/href="(\.\/|index\.html|index-ko\.html)(?=[?"#])/g,
				(_, Target) => 'href="' + (Target === 'index-ko.html' ? Korean : English));
		await writeFile(join(Output, Index === 0 ? English : Korean), FixedPage);
		if (Variant === DefaultVariant)
		{
			await writeFile(join(Output, Index === 0 ? 'index.html' : 'index-ko.html'), Page);
		}
	}
}
console.log('Built both homepage variants. Main homepage: ' + DefaultVariant);
