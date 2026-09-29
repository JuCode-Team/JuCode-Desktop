// Opens the "models to show" picker (ModelSetup.svelte, mounted by the page):
// after a JuCode login, and from Settings.
class ModelSetupState {
	open = $state(false);
}
export const modelSetup = new ModelSetupState();
