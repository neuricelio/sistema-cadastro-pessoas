// ABAS
document.querySelectorAll('.aba').forEach(aba => {
  aba.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
    document.querySelectorAll('.conteudo-aba').forEach(c => c.classList.remove('ativa'));
    aba.classList.add('ativa');
    document.getElementById('aba-' + aba.dataset.aba).classList.add('ativa');
  });
});

// CÁLCULO DE IDADE
function calcularIdade(dataNasc) {
  if (!dataNasc) return '';
  const nasc = new Date(dataNasc);
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mes = hoje.getMonth() - nasc.getMonth();
  const dia = hoje.getDate() - nasc.getDate();
  if (mes < 0 || (mes === 0 && dia < 0)) idade--;
  return idade + ' anos';
}

document.addEventListener('DOMContentLoaded', () => {
  const nasc = document.getElementById('nascimento');
  const idade = document.getElementById('idade');
  if(nasc && idade){
    if(nasc.value) idade.value = calcularIdade(nasc.value);
    nasc.addEventListener('change', () => idade.value = calcularIdade(nasc.value));
  }

  // ======================
  // PRÉVIA DE FOTOS — AQUI EXECUTA DEPOIS DA PÁGINA CARREGAR
  // ======================
  const campoFotos = document.getElementById('campo-fotos');
  const preview = document.getElementById('preview-fotos');
  const salvas = document.getElementById('fotos-salvas');

  if (campoFotos && preview && salvas) {
    campoFotos.addEventListener('change', (e) => {
      preview.innerHTML = '';
      if (e.target.files.length > 0) {
        salvas.style.display = 'none';
        Array.from(e.target.files).forEach(arquivo => {
          const leitor = new FileReader();
          leitor.onload = (evt) => {
            const img = document.createElement('img');
            img.src = evt.target.result;
            img.className = 'miniatura';
            preview.appendChild(img);
          };
          leitor.readAsDataURL(arquivo);
        });
      } else {
        salvas.style.display = '';
      }
    });
  }
});

// ADICIONAR LINHA DE PROCESSO
let contadorProc = 0;
function adicionarLinhaProcesso(dados = []){
  const div = document.createElement('div');
  div.className = 'linha-processo';
  div.innerHTML = `
    <input type="text" name="proc_numero" placeholder="Nº Processo" value="${dados[0]||''}">
    <input type="date" name="proc_data" value="${dados[1]||''}">
    <input type="text" name="proc_tipificacao" placeholder="Tipificação" value="${dados[2]||''}">
    <input type="text" name="proc_descricao" placeholder="Descrição" value="${dados[3]||''}">
    <button type="button" class="btn btn-remover" onclick="this.parentElement.remove()">×</button>
  `;
  document.getElementById('lista-processos').appendChild(div);
}

const btnAddProc = document.getElementById('addProcesso');
if(btnAddProc) btnAddProc.addEventListener('click', () => adicionarLinhaProcesso());

// AÇÕES DOS BOTÕES
document.getElementById('btnDesativar')?.addEventListener('click', () => {
  if(confirm('Deseja desativar este cadastro?')){
    const id = document.querySelector('input[name="id"]').value;
    const f = document.createElement('form');
    f.method='POST'; f.action=`/desativar/${id}`; f.submit();
  }
});
document.getElementById('btnExcluir')?.addEventListener('click', () => {
  if(confirm('CONFIRMA EXCLUSÃO TOTAL?')){
    const id = document.querySelector('input[name="id"]').value;
    const f = document.createElement('form');
    f.method='POST'; f.action=`/excluir/${id}`; f.submit();
  }
});

// ==============================================
// MÁSCARAS DOS CAMPOS
// ==============================================
function aplicarMascaraCPF(campo) {
  let valor = campo.value.replace(/\D/g, '');
  if (valor.length > 11) valor = valor.slice(0,11);
  valor = valor.replace(/(\d{3})(\d)/, '$1.$2');
  valor = valor.replace(/(\d{3})(\d)/, '$1.$2');
  valor = valor.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  campo.value = valor;
}

function aplicarMascaraCEP(campo) {
  let valor = campo.value.replace(/\D/g, '');
  if (valor.length > 8) valor = valor.slice(0,8);
  valor = valor.replace(/(\d{5})(\d)/, '$1-$2');
  campo.value = valor;
}

function aplicarMascaraProcesso(campo) {
  let valor = campo.value.replace(/\D/g, '');
  if (valor.length > 25) valor = valor.slice(0,25);
  valor = valor.replace(/(\d{7})(\d)/, '$1-$2');
  valor = valor.replace(/(\d{7})-(\d{2})(\d)/, '$1-$2.$3');
  valor = valor.replace(/(\d{7})-(\d{2})\.(\d{4})(\d)/, '$1-$2.$3.$4');
  valor = valor.replace(/(\d{7})-(\d{2})\.(\d{4})\.(\d{1})(\d)/, '$1-$2.$3.$4.$5');
  valor = valor.replace(/(\d{7})-(\d{2})\.(\d{4})\.(\d{1})\.(\d{2})(\d)/, '$1-$2.$3.$4.$5.$6');
  valor = valor.replace(/(\d{7})-(\d{2})\.(\d{4})\.(\d{1})\.(\d{2})\.(\d{4})(\d+)$/, '$1-$2.$3.$4.$5.$6');
  campo.value = valor;
}

function aplicarMascaraPena(campo) {
  let valor = campo.value.replace(/[^0-9amd]/gi, '').toLowerCase();
  let nums = valor.replace(/\D/g, '');
  if (nums.length > 7) nums = nums.slice(0,7);
  let resultado = '';
  if (nums.length >= 1) resultado += nums.slice(0,3) + 'a';
  if (nums.length >= 3) resultado += nums.slice(3,5) + 'm';
  if (nums.length >= 5) resultado += nums.slice(5,7) + 'd';
  campo.value = resultado;
}

document.addEventListener('input', e => {
  if (e.target.id === 'cpf') aplicarMascaraCPF(e.target);
  if (e.target.id === 'cep') aplicarMascaraCEP(e.target);
  if (e.target.name === 'processo_unificado' || e.target.name === 'proc_numero') aplicarMascaraProcesso(e.target);
  if (e.target.name === 'pena_total') aplicarMascaraPena(e.target);
});

// BUSCA DE CEP CORRIGIDA (USANDO API PÚBLICA NO NAVEGADOR)
document.getElementById('cep')?.addEventListener('blur', async e => {
  const cep = e.target.value.replace(/\D/g, '');
  if (cep.length === 8) {
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const endereco = await res.json();
      if(endereco.erro) throw new Error('CEP não encontrado');
      document.getElementById('rua').value = endereco.logradouro || '';
      document.getElementById('bairro').value = endereco.bairro || '';
      document.getElementById('cidade').value = endereco.localidade || '';
      document.getElementById('uf').value = endereco.uf || '';
    } catch {
      alert('CEP não encontrado.');
    }
  }
});

// Atualiza Data e Hora - Tela Inicial
function atualizarDataHora() {
  const el = document.getElementById('data-hora');
  if (!el) return;
  const agora = new Date();
  const data = agora.toLocaleDateString('pt-BR');
  const hora = agora.toLocaleTimeString('pt-BR');
  el.textContent = `${data} ${hora}`;
}

// Inicia a função quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
  atualizarDataHora();
  setInterval(atualizarDataHora, 1000);
});