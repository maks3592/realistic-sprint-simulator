(function(){
  var link=document.getElementById('dl');
  var bar=document.getElementById('bar');
  var note=document.getElementById('dlNote');
  if(!link||!window.fetch)return;
  link.addEventListener('click',function(e){
    e.preventDefault();
    bar.hidden=false;
    var fill=bar.firstElementChild;
    var shown=0;
    var timer=setInterval(function(){shown=Math.min(shown+8,92);fill.style.width=shown+'%'},180);
    note.textContent='Качаю, подожди секунду…';
    setTimeout(function(){
      clearInterval(timer);
      fill.style.width='100%';
      note.textContent='Если загрузка не началась, нажми ещё раз или открой Releases на GitHub.';
      window.location.href=link.href;
    },1400);
  });
})();
