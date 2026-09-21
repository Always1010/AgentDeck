fetch('./data.json').then(r=>r.json()).then(d=>document.querySelector('#data').textContent=`演示指数：${d.index}（仅为资源读取验证）`);
