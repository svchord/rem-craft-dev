/* SiYuanPluginSystem */
;(async () => {
    window.pluginSystemSource = 'bazzar'
    const response = await fetch('/api/file/getFile', {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json'
        },
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ path: '/data/widgets/插件系统/plugin.js' })
    })
    const js = await response.text()
    eval(js)
})()
