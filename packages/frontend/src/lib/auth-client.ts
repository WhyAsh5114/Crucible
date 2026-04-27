import { createAuthClient } from 'better-auth/svelte';
import { siweClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [siweClient()]
});
