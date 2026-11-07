import {ToolConfig} from '../lib/tool-config.mjs';
/**
 * 소유 JavaScript의 식별자와 블록 서식을 AST로 변환합니다. Node에 이미 포함된 Acorn만
 * 사용하며 패키지를 설치하지 않습니다. 실행: node --expose-internals tools/maintenance/format-unreal.mjs --write
 * JSON/API 속성·문자열·정규식·주석은 보존합니다. 단축 속성/분해/가져오기는 이름을
 * 명시해 외부 키를 유지합니다. 공개 export와 함수 직렬화에서 쓰는 전역 이름도 유지합니다.
 */
import {createRequire as CreateRequire} from 'node:module';
import {readdir as Readdir, readFile as ReadFile, writeFile as WriteFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath as FileURLToPath} from 'node:url';
const Require = CreateRequire(import.meta.url);
const {parse} = Require('internal/deps/acorn/acorn/dist/acorn');
const Root = ToolConfig.root;
const bWrite = process.argv.includes('--write');
const Report = [];
function Parse(Source, Tokens)
{
	return parse(Source, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, onToken: Tokens});
}

function Children(Node)
{
	return Object.entries(Node).flatMap(([Key, Value]) => Array.isArray(Value)
	? Value.filter(Item => Item?.type).map(Item => [Key, Item]) : Value?.type ? [[Key, Value]] : []);
}

function Rename(Source)
{
	const Tree = Parse(Source);
	const RootScope = {bindings: new Map(), parent: null, bFunction: true};
	const Scopes = new WeakMap(), Bindings = new WeakMap(), Parents = new WeakMap();
	const AllBindings = [], Public = new Set();
	function Pattern(Node, Scope, Value)
	{
		if (!Node)
		{
			return;
		}
		if (Node.type === 'Identifier')
		{
			let Binding = Scope.bindings.get(Node.name);
			if (!Binding)
			{
				Binding = {name: Node.name, scope: Scope, value: Value};
				Scope.bindings.set(Node.name, Binding);
				AllBindings.push(Binding);
			}
			Bindings.set(Node, Binding);
		}
		else if (Node.type === 'RestElement')
		{
			Pattern(Node.argument, Scope);
		}
		else if (Node.type === 'AssignmentPattern')
		{
			Pattern(Node.left, Scope, Node.right);
		}
		else if (Node.type === 'ArrayPattern')
		{
			for (const Item of Node.elements)
			{
				Pattern(Item, Scope);
			}
		}
		else if (Node.type === 'ObjectPattern')
		{
			for (const Property of Node.properties)
			{
				Pattern(Property.type === 'RestElement' ? Property.argument : Property.value, Scope);
			}
		}
	}
	function Visit(Node, Scope, Parent, Key)
	{
		Parents.set(Node, {parent: Parent, key: Key});
		if (Node.type === 'FunctionDeclaration')
		{
			Pattern(Node.id, Scope);
		}
		if (Node.type === 'ClassDeclaration')
		{
			Pattern(Node.id, Scope);
		}
		const bFunction = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(Node.type);
		if (bFunction || ['BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement'].includes(Node.type))
		{
			Scope = {bindings: new Map(), parent: Scope, bFunction};
		}
		Scopes.set(Node, Scope);
		if (bFunction)
		{
			if (Node.type === 'FunctionExpression')
			{
				Pattern(Node.id, Scope);
			}
			for (const Parameter of Node.params)
			{
				Pattern(Parameter, Scope);
			}
		}
		if (Node.type === 'CatchClause')
		{
			Pattern(Node.param, Scope);
		}
		if (Node.type === 'VariableDeclaration')
		{
			let Owner = Scope;
			if (Node.kind === 'var')
			{
				while (Owner.parent && !Owner.bFunction)
				{
					Owner = Owner.parent;
				}
			}
			for (const Item of Node.declarations)
			{
				Pattern(Item.id, Owner, Item.init);
			}
		}
		if (Node.type === 'ImportDeclaration')
		{
			for (const Item of Node.specifiers)
			{
				Pattern(Item.local, Scope);
			}
		}
		if (Node.type === 'ExportNamedDeclaration')
		{
			if (Node.declaration?.id)
			{
				Public.add(Node.declaration.id.name);
			}
			for (const Item of Node.declaration?.declarations ?? [])
			{
				if (Item.id.type === 'Identifier')
				{
					Public.add(Item.id.name);
				}
			}
			for (const Item of Node.specifiers)
			{
				Public.add(Item.local.name);
			}
		}
		for (const [ChildKey, Child] of Children(Node))
		{
			Visit(Child, Scope, Node, ChildKey);
		}
	}
	Visit(Tree, RootScope);
	for (const Binding of AllBindings)
	{
		const Name = Binding.name;
		if (!/^[a-z][A-Za-z0-9]*$/.test(Name) || /^b[A-Z]/.test(Name) || (Binding.scope === RootScope && Public.has(Name)))
		{
			continue;
		}
		const bBoolean = Binding.value?.type === 'Literal' && typeof Binding.value.value === 'boolean' ||
		Binding.value?.type === 'UnaryExpression' && Binding.value.operator === '!' ||
		/^(is|has|can|should|did|was)[A-Z]|^(enabled|playing|hidden|disposed|settled|canceled|paused|ended)$/.test(Name);
		const Next = (bBoolean ? 'b' : '') + Name[0].toUpperCase() + Name.slice(1);
		if (!(Next in globalThis) && !['Image', 'Window', 'Document', 'Element', 'Node', 'HTMLElement', 'HTMLMediaElement', 'MediaRecorder', 'MediaStream', 'FileReader', 'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver'].includes(Next) && !AllBindings.some(Existing => Existing.name === Next))
		{
			Binding.next = Next;
		}
	}
	const Edits = new Map();
	function EditIdentifiers(Node)
	{
		if (Node.type === 'Identifier')
		{
			const {parent: Parent, key: Key} = Parents.get(Node);
			const bExternal = Parent && (
			(['MemberExpression', 'Property', 'MethodDefinition', 'PropertyDefinition'].includes(Parent.type) && !Parent.computed && ['property', 'key'].includes(Key)) ||
			Parent.type === 'ImportSpecifier' && Key === 'imported' || Parent.type === 'ExportSpecifier' && Key === 'exported' ||
			['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(Parent.type) && Key === 'label');
			let Binding = Bindings.get(Node);
			if (!Binding && !bExternal)
			{
				let Scope = Scopes.get(Node);
				while (Scope && !Scope.bindings.has(Node.name))
				{
					Scope = Scope.parent;
				}
				Binding = Scope?.bindings.get(Node.name);
			}
			if (!bExternal && Binding?.next)
			{
				let Text = Binding.next;
				if (Parent.type === 'Property' && Parent.shorthand && Key === 'value')
				{
					Text = Node.name + ': ' + Text;
				}
				// 분해 기본값은 Property.value가 AssignmentPattern이므로 키와 대입 왼쪽 사이에 별칭을 둡니다.
				const Grand = Parents.get(Parent);
				if (Parent.type === 'AssignmentPattern' && Key === 'left' && Grand?.parent.type === 'Property' && Grand.parent.shorthand)
				{
					Text = Node.name + ': ' + Text;
				}
				if (Parent.type === 'ImportSpecifier' && Parent.imported.start === Node.start)
				{
					Text = Node.name + ' as ' + Text;
				}
				Edits.set(Node.start, {start: Node.start, end: Node.end, text: Text});
			}
		}
		for (const [, Child] of Children(Node))
		{
			EditIdentifiers(Child);
		}
	}
	EditIdentifiers(Tree);
	for (const Edit of [...Edits.values()].sort((A, B) => B.start - A.start))
	{
		Source = Source.slice(0, Edit.start) + Edit.text + Source.slice(Edit.end);
	}
	return {source: Source, renamed: Edits.size};
}

/** 단일 제어문도 명시적 블록으로 만듭니다. 원래 문장의 범위를 AST에서 읽어
 * dangling else나 루프의 본문을 추측하지 않습니다. var/return/break의 의미는 유지합니다. */
function BracketControls(Source)
{
	const Insertions = [];
	function Wrap(Node)
	{
		if (!Node || Node.type === 'BlockStatement')
		{
			return;
		}
		Insertions.push({at: Node.start, text: '{\n'}, {at: Node.end, text: '\n}'});
	}
	function Visit(Node)
	{
		if (Node.type === 'IfStatement')
		{
			Wrap(Node.consequent);
			if (Node.alternate?.type !== 'IfStatement')
			{
				Wrap(Node.alternate);
			}
		}
		if (['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement', 'WithStatement'].includes(Node.type))
		{
			Wrap(Node.body);
		}
		for (const [, Child] of Children(Node))
		{
			Visit(Child);
		}
	}
	Visit(Parse(Source));
	for (const Insertion of Insertions.sort((A, B) => B.at - A.at))
	{
		Source = Source.slice(0, Insertion.at) + Insertion.text + Source.slice(Insertion.at);
	}
	return Source;
}

function Format(Source)
{
	Source = Source.replace(/\r\n/g, '\n');
	const Tokens = [], Tree = Parse(Source, Tokens);
	const Gaps = new Map(), Blocks = [], ForHeaders = [], Unary = new Set();
	function Visit(Node)
	{
		if (['BlockStatement', 'ClassBody', 'StaticBlock'].includes(Node.type))
		{
			Blocks.push(Node);
		}
		if (Node.type === 'SwitchStatement')
		{
			Blocks.push({start: Tokens.find(Token => Token.start >= Node.discriminant.end && Token.type.label === '{')?.start, end: Node.end});
		}
		if (Node.type === 'ForStatement')
		{
			ForHeaders.push([Node.start, Node.body.start]);
		}
		if (Node.type === 'UnaryExpression' || Node.type === 'UpdateExpression')
		{
			Unary.add(Node.start);
		}
		for (const [, Child] of Children(Node))
		{
			Visit(Child);
		}
	}
	Visit(Tree);
	function Gap(Left, Right, Text)
	{
		if (!Left || !Right || !/^\s*$/.test(Source.slice(Left.end, Right.start)))
		{
			return;
		}
		const Key = Left.end + ':' + Right.start;
		if (Gaps.get(Key)?.text === '\n')
		{
			return;
		}
		Gaps.set(Key, {start: Left.end, end: Right.start, text: Text});
	}
	for (const Block of Blocks)
	{
		const Open = Tokens.findIndex(Token => Token.start === Block.start);
		const Close = Tokens.findIndex(Token => Token.end === Block.end && Token.type.label === '}');
		if (Open < 0 || Close < 0)
		{
			continue;
		}
		Gap(Tokens[Open - 1], Tokens[Open], '\n');
		Gap(Tokens[Open], Tokens[Open + 1], '\n');
		Gap(Tokens[Close - 1], Tokens[Close], '\n');
		if (['else', 'catch', 'finally'].includes(Tokens[Close + 1]?.type.label))
		{
			Gap(Tokens[Close], Tokens[Close + 1], '\n');
		}
	}
	for (let Index = 0; Index < Tokens.length; Index++)
	{
		const Token = Tokens[Index], Label = Token.type.label, Previous = Tokens[Index - 1], Next = Tokens[Index + 1];
		if (Label === ';' && !ForHeaders.some(([Start, End]) => Token.start >= Start && Token.end <= End))
		{
			Gap(Token, Next, '\n');
		}
		else if (Label === ',' || Label === ':' || Label === ';')
		{
			if (Next && !Source.slice(Token.end, Next.start).includes('\n'))
			{
				Gap(Token, Next, ' ');
			}
		}
		if ((Token.type.isAssign || Token.type.binop || ['=>', '?', '='].includes(Label)) && !Unary.has(Token.start))
		{
			if (Previous && !Source.slice(Previous.end, Token.start).includes('\n'))
			{
				Gap(Previous, Token, ' ');
			}
			if (Next && !Source.slice(Token.end, Next.start).includes('\n'))
			{
				Gap(Token, Next, ' ');
			}
		}
		if (['if', 'for', 'while', 'switch', 'catch', 'with'].includes(Label) && Next?.type.label === '(')
		{
			Gap(Token, Next, ' ');
		}
	}
	for (const Edit of [...Gaps.values()].sort((A, B) => B.start - A.start))
	{
		Source = Source.slice(0, Edit.start) + Edit.text + Source.slice(Edit.end);
	}
	const NewTokens = [];
	Parse(Source, NewTokens);
	const Lines = Source.split('\n');
	let Offset = 0, Index = 0, Depth = 0;
	const Output = [];
	for (const Line of Lines)
	{
		const End = Offset + Line.length, LineTokens = [];
		while (Index < NewTokens.length && NewTokens[Index].start < End)
		{
			LineTokens.push(NewTokens[Index++]);
		}
		const bLiteralLine = NewTokens[Index - LineTokens.length - 1]?.end > Offset;
		const First = LineTokens[0]?.type.label;
		const Indent = Math.max(0, Depth - (First === '}' || First === ']' ? 1 : 0));
		const Trimmed = Line.trim();
		Output.push(bLiteralLine ? Line : !Trimmed ? '' : '\t'.repeat(Indent) + (Trimmed.startsWith('*') ? ' ' : '') + Trimmed);
		for (const Token of LineTokens)
		{
			if (['{', '[', String.fromCharCode(36) + '{'].includes(Token.type.label))
			{
				Depth++;
			}
			if (['}', ']'].includes(Token.type.label))
			{
				Depth--;
			}
		}
		Offset = End + 1;
	}
	const Result = Output.join('\n').trimEnd() + '\n';
	const Canonical = Value => JSON.stringify(Value, (Key, Item) => ['start', 'end', 'raw'].includes(Key) ? undefined : typeof Item === 'bigint' ? String(Item) : Item);
	if (Canonical(Tree) !== Canonical(Parse(Result)))
	{
		throw new Error('Formatting changed syntax tree');
	}
	return Result;
}

async function Walk(Directory)
{
	for (const Entry of await Readdir(Path.join(Root, Directory), {withFileTypes: true}))
	{
		if (Entry.name === 'vendor' || Entry.name === 'assets')
		{
			continue;
		}
		const File = Path.join(Directory, Entry.name);
		if (Entry.isDirectory())
		{
			await Walk(File);
		}
		else if (/\.(m?js)$/.test(File))
		{
			const Before = await ReadFile(Path.join(Root, File), 'utf8');
			const Renamed = Rename(Before);
			const After = Format(BracketControls(Renamed.source));
			if (After !== Before)
			{
				Report.push({file: File, renamed: Renamed.renamed});
				if (bWrite)
				{
					await WriteFile(Path.join(Root, File), After);
				}
			}
		}
	}
}
for (const Directory of ['extension', 'website', 'tools', 'tests'])
{
	await Walk(Directory);
}
console.log(JSON.stringify({write: bWrite, files: Report.length, renamed: Report.reduce((Count, Item) => Count + Item.renamed, 0), report: Report}));
