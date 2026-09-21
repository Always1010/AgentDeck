import './style.css';
document.querySelector('#convert')!.addEventListener('click',()=>{const value=Number((document.querySelector('#tonnes') as HTMLInputElement).value);document.querySelector('#result')!.textContent=`${value * 1000} 千克`;});
