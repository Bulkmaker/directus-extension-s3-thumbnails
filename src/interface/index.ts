import { defineInterface } from '@directus/extensions-sdk';
import InterfaceComponent from './component.vue';

export default defineInterface({
	id: 'thumbnails-panel',
	name: 'Thumbnails Panel',
	description: 'Показывает сгенерированные миниатюры для файла с ссылками на S3',
	icon: 'photo_size_select_large',
	component: InterfaceComponent,
	types: ['alias'],
	localTypes: ['presentation'],
	group: 'presentation',
	options: null,
});
