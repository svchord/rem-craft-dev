import { isDockExist, setDockObserver } from './layout.js';

function addIcon(top) {
    top.insertAdjacentHTML(
        'afterbegin',
        `<div id="appIcon"
            style="
                display: flex;
                margin-left: 4px;
                width: 36px;
                height: 40px;
                padding: 12px 10px;
            "
        >
        <svg
            version="1.1"
            id="Layer_1"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            x="0px"
            y="0px"
            width="16px"
            height="16px"
            viewBox="0 0 128 128"
            enable-background="new 0 0 128 128"
            xml:space="preserve"
        >
            <image
                id="image0"
                width="128"
                height="128"
                x="0"
                y="0"
                href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAABGdBTUEAALGPC/xhBQAAACBjSFJN AAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAilBMVEUAAADaOTk7PkOAgIDa OTlhPUE7PkPaOTm1Ojs7PkPaOTlMPUI7PkPaOTnJOjo7PkPaOTk7PkM7PkPaOTk7PkM7PkPaOTk7 PkPaOTnaOTlMPULIOjo7PkPaOTk7PkM7PkPaOTnaOTk7PkM7PkM7PkPaOTk7PkM7PkPaOTk7PkPa OTnaOTk7PkP///+hK+NFAAAAK3RSTlMAAAAASJsLC5pI+MrBwcr3wvjCSUkMDPn5/LGx/FcKvr0K WFe9Vla8vFVV/bvM0wAAAAFiS0dELc3aQT0AAAAHdElNRQflCQ4OFhhi+DVYAAAC/klEQVR42u3O 2XITMRSE4YwwDk4gECcQBmyzL2H0/s/HSJpFy+kjySVSXJy+7qr/u7iQyWQymUwmk/1H67htnm9V OnC+fLFT3M4AbK6uX25LAZevbl7v2gI2V8O1JgSgP9xoVlANGPsjgBCA/ghgBbUA0zeAVED13wwW wAkqAbZvAYkA9C1A3+7aAFzfAWIB6DsAFlQBpv4E0PstB5j6EwAKagBzfwaEAtCfAUhQAVj6CyAQ gP4CAIJywNpfAb4A9FcALSgGeH0P4AlA3wOQglKA3/cBqwD0fQAlKAQE/QCwCEA/ABCCMsBd0A8B swD0Q4C+vT8HEPUjwCQA/QiQCEoAcT8GOAHox4BYUABI+glA79/OgKSfACJBHpD2U4ARgH4KCAVZ ANEnAKMA9AlAIMgBqD4FsAKqTwF8QQZA9knAKHhH9UmAJ+ABdJ8G6D3ZpwGrgAWAPgDooQKwCDgA 6jcBzAIGAPttAPrhngfgfiOAE0AA028FsAIE4PrNAEYAAHfvh6cAjAIAYPsNAfoBAIanAmgBCEAA AhCAAAQgAAEIQAACEIAAzgH0H2oAHw+tAf3x9Kkc8PnL10NbQH9UihbQ/a77dmgJ6I+dAgLQ7xQn qAWMfQMgBaA//hlBJcD0LUCdvucBrm/+WFAHsH0HIASgb/9QUAVw/QmQCkDf/ZGgBjD1Z0AiAP3p DwQVgLm/AGIB6M9/WlAOWPorIBKA/vInBcWA/keXAkIB6K9/SlAK8Po+IBCAvvcnBIUAvx8AfAHo +/+fh/MAQT8EeALQD/6JoAgQ9iOAOv0KAXE//MeCEkDUjwGLAPSjfyQoAMT9BDALQD/+h4I8IOmn gElg3r/TfvIPBFlA2icATgD66d8X5ABEnwJYAegTf0+QAVB9EmAEoE/9VwEPIPs0YBSAPvlfBCyA 7gNAdwJ9+v94yANAHwHgFCdgAKhv9qx4Cs4JMKD/0/1bgBNAANtvA7ACBOD7jQBGAACZfivAKACA TL8ZQD1eyGQymUwmk8nW/QW7ckbrSg/IIQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyMS0wOS0xNFQx MToyMjoyNCswMzowMC6/xaQAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjEtMDktMTRUMTE6MjI6MjQr MDM6MDBf4n0YAAAAAElFTkSuQmCC"
            />
        </svg>
    </div>`
    );
}

export function appIconMain() {
    const topBar = document.getElementById('toolbar');
    if (topBar) {
        if (isDockExist('left')) {
            addIcon(topBar);
        }
        setDockObserver('left', () => {
            const icon = document.getElementById('appIcon');
            if (isDockExist('left') && !icon) {
                addIcon(topBar);
            } else {
                icon.remove();
            }
        });
    }
}
