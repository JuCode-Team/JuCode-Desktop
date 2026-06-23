// Svelte action: keep Tab focus inside a modal and restore focus to whatever
// opened it once it closes. Apply with `use:focusTrap` on the dialog element.

const SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusTrap(node: HTMLElement) {
	const opener = document.activeElement as HTMLElement | null;
	const focusables = () =>
		Array.from(node.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => el.offsetParent !== null);

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const els = focusables();
		if (els.length === 0) {
			e.preventDefault();
			node.focus();
			return;
		}
		const first = els[0];
		const last = els[els.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === node)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// Move focus into the dialog — an explicit autofocus target, else the first
	// focusable, else the dialog itself.
	const initial = focusables();
	const auto = initial.find((el) => el.hasAttribute('autofocus'));
	(auto ?? initial[0] ?? node).focus();
	node.addEventListener('keydown', onKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			opener?.focus?.();
		}
	};
}
