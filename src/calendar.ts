import { Plugin, Menu, clientApi } from 'siyuan';

export default class CalendarPlugin extends Plugin {
    el: HTMLElement;

    constructor() {
        super();
        this.el = document.createElement('button');
    }

    onload() {
        this.el.innerHTML = `<svg t="1662957805816" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2374" width="200" height="200"><path d="M797.257 402.286h-570.514v113.371h570.514v-113.371zM910.629 76.8h-58.514v-76.8h-113.371v76.8h-453.486v-76.8h-113.371v76.8h-58.514c-62.171 0-113.371 51.2-113.371 113.371v724.114c0 62.171 51.2 109.714 113.371 109.714h797.257c62.171 0 113.371-47.543 113.371-109.714v-724.114c0-62.171-51.2-113.371-113.371-113.371zM910.629 914.286h-797.257v-625.371h797.257v625.371zM625.371 629.029h-398.629v113.371h398.629v-113.371z"></path></svg>`;
        clientApi.addToolbarLeft(this.el);
        this.el.addEventListener('click', () => {
            const calendar = new Menu('Calendar');
            // calendar.insertAdjacentHTML(
            //     'beforeend',
            //     `<iframe
            //         id="calendarIframe"
            //         src="/appearance/themes/Rem Craft Test/app/calendar/"
            //     />
            //     `
            // );
        });
        // console.log('plugin load');
    }

    onunload() {
        // console.log('plugin unload');
        this.el && this.el.remove();
    }
}
