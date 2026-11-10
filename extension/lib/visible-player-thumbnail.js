/** Read only the current Meta player's visible pixels when its canvas is tainted. */
export async function CaptureVisiblePlayerThumbnail(TabId, DocumentId, Page, Crop, Size)
{
	if (!Crop || ![Crop.x, Crop.y, Crop.width, Crop.height, Crop.viewportWidth, Crop.viewportHeight].every(Number.isFinite) ||
		Crop.x < 0 || Crop.y < 0 || Crop.width <= 0 || Crop.height <= 0 ||
		Crop.x + Crop.width > Crop.viewportWidth || Crop.y + Crop.height > Crop.viewportHeight) return null;
	try
	{
		const Tab = await chrome.tabs.get(TabId);
		if (!Tab.active) return null;
		async function IsCurrent()
		{
			const [Active] = await chrome.tabs.query({active: true, windowId: Tab.windowId});
			if (Active?.id !== TabId) return false;
			const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]},
				func: ValidateVisiblePlayerCrop, args: [Page, Crop]});
			return Frame?.documentId === DocumentId && Frame.result === true;
		}
		if (!await IsCurrent()) return null;
		const Screenshot = await chrome.tabs.captureVisibleTab(Tab.windowId, {format: 'jpeg', quality: 85});
		if (!await IsCurrent()) return null;
		const Bytes = Uint8Array.from(atob(Screenshot.split(',', 2)[1]), Char => Char.charCodeAt(0));
		const Bitmap = await createImageBitmap(new Blob([Bytes], {type: 'image/jpeg'}));
		try
		{
			const Scale = Math.min(Size.maxWidth / Crop.width, Size.maxHeight / Crop.height, 1);
			if (!Number.isFinite(Scale) || Scale <= 0) return null;
			const Canvas = new OffscreenCanvas(Math.max(1, Math.round(Crop.width * Scale)), Math.max(1, Math.round(Crop.height * Scale)));
			Canvas.getContext('2d').drawImage(Bitmap, Crop.x * Bitmap.width / Crop.viewportWidth, Crop.y * Bitmap.height / Crop.viewportHeight,
				Crop.width * Bitmap.width / Crop.viewportWidth, Crop.height * Bitmap.height / Crop.viewportHeight, 0, 0, Canvas.width, Canvas.height);
			const Image = await Canvas.convertToBlob({type: 'image/jpeg', quality: Size.jpegQuality});
			if (!await IsCurrent()) return null;
			const Output = new Uint8Array(await Image.arrayBuffer());
			let Binary = '';
			for (let Index = 0; Index < Output.length; Index += 8192) Binary += String.fromCharCode(...Output.subarray(Index, Index + 8192));
			return 'data:image/jpeg;base64,' + btoa(Binary);
		}
		finally {Bitmap.close();}
	}
	catch {return null;}
}

/** Serialized into the source document. Revalidate before and after native capture. */
export function ValidateVisiblePlayerCrop(Page, Crop)
{
	if (location.href !== Page || document.visibilityState !== 'visible' ||
		innerWidth !== Crop.viewportWidth || innerHeight !== Crop.viewportHeight) return false;
	const Players = [...document.querySelectorAll('video')].filter(Player =>
	{
		if (Player.readyState < 2 || !Player.videoWidth || (Crop.excludedSelector && Player.closest(Crop.excludedSelector))) return false;
		for (let Node = Player; Node; Node = Node.parentElement)
		{
			const Style = getComputedStyle(Node);
			if (Node === Player && Style.visibility !== 'visible' || Style.opacity === '0') return false;
		}
		const Bounds = Player.getBoundingClientRect();
		return Bounds.width > 0 && Bounds.height > 0 && Bounds.bottom > 0 && Bounds.right > 0 && Bounds.top < innerHeight && Bounds.left < innerWidth;
	});
	if (Players.length !== 1 || Players[0].currentSrc !== Crop.source) return false;
	const [Player] = Players;
	const Bounds = Player.getBoundingClientRect();
	const X = Math.max(0, Bounds.left), Y = Math.max(0, Bounds.top);
	const Width = Math.min(innerWidth, Bounds.right) - X, Height = Math.min(innerHeight, Bounds.bottom) - Y;
	if (Math.abs(X - Crop.x) >= 1 || Math.abs(Y - Crop.y) >= 1 ||
		Math.abs(Width - Crop.width) >= 1 || Math.abs(Height - Crop.height) >= 1) return false;
	for (const Horizontal of [0.1, 0.5, 0.9]) for (const Vertical of [0.1, 0.5, 0.9])
	{
		const Hit = document.elementFromPoint(X + Width * Horizontal, Y + Height * Vertical);
		if (!Hit) return false;
		const Dialog = Hit.closest?.('dialog, [role="dialog"], [aria-modal="true"]');
		if (Dialog && !Dialog.contains?.(Player)) return false;
		if (Hit === Player || Player.contains(Hit) || Hit.contains?.(Player)) continue;
		// Native controls can be siblings a few wrappers above the video. Restrict
		// this exception to button chrome inside the same tightly sized media box.
		if (!Hit.closest?.('button, [role="button"]')) return false;
		let InsideControls = false, Depth = 0;
		for (let Container = Player.parentElement; Container && Depth++ < 4; Container = Container.parentElement)
		{
			const Box = Container.getBoundingClientRect();
			if (Box.width > Bounds.width * 1.05 + 2 || Box.height > Bounds.height * 1.05 + 2) break;
			if (Container.contains(Hit)) {InsideControls = true; break;}
		}
		if (!InsideControls) return false;
	}
	return true;
}
