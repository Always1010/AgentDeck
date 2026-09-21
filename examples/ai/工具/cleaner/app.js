document.querySelector('#clean').addEventListener('click',()=>{document.querySelector('#output').textContent=document.querySelector('#input').value.trim().replace(/\s+/g,' ');});
