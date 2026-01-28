import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './component.vue';

export default defineModule({
	id: 'thumbnails-manager',
	name: 'Thumbnails',
	icon: 'photo_size_select_large',
	routes: [
		{
			path: '',
			component: ModuleComponent,
		},
	],
});
