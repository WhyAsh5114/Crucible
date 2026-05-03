export function scrollZoom(node: HTMLElement) {
	let ticking = false;
	const section = node.closest('section');

	function updateZoom() {
		if (!section) return;

		const sectionRect = section.getBoundingClientRect();
		const windowHeight = window.innerHeight;

		// Calculate scroll progress based on section position
		// 0 = section at top, 1 = section scrolled past
		const scrollProgress = Math.max(0, Math.min(1, -sectionRect.top / windowHeight));

		// Scale from 1 to 1.3 (enlarged but fully visible)
		const scale = 1 + scrollProgress * 0.3;

		// Fade out text content as image zooms
		const textOpacity = Math.max(0, 1 - scrollProgress * 1.5);

		// Apply transforms with smooth transition
		node.style.transform = `scale(${scale})`;
		node.style.transition = 'transform 0.1s ease-out';

		// Update text opacity for elements in the section
		const textElements = section.querySelectorAll('[data-zoom-fade]');
		textElements.forEach((el) => {
			(el as HTMLElement).style.opacity = String(textOpacity);
			(el as HTMLElement).style.transition = 'opacity 0.2s ease-out';
		});

		ticking = false;
	}

	function onScroll() {
		if (!ticking) {
			window.requestAnimationFrame(updateZoom);
			ticking = true;
		}
	}

	// Initial state
	updateZoom();

	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', updateZoom, { passive: true });

	return {
		destroy() {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', updateZoom);
		}
	};
}
