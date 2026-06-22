declare global {
	namespace App {}
}

declare module '*.svg?raw' {
	const content: string;
	export default content;
}

export {};
