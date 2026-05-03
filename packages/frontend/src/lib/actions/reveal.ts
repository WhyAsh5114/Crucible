export function reveal(node: HTMLElement, options?: { delay?: number }) {
	const delay = options?.delay ?? 0;
	node.style.transitionDelay = `${delay}ms`;
	node.classList.add('reveal');

	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					node.classList.add('is-visible');
					observer.unobserve(node);
				}
			});
		},
		{ threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
	);

	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
