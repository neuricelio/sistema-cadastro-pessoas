const express = require('express');
const ejs = require('ejs');
const mysql = require('mysql2/promise'); // ← ESSA É A LINHA QUE ESTAVA DANDO ERRO
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cep = require('cep-promise');
const path = require('path');
const session = require('express-session');
const fs = require('fs-extra');
const caminhoPasta = './pasta-fotos/';

const app = express();
const porta = process.env.PORT || 3000;
app.listen(porta, () => {
  console.log(`✅ Sistema rodando na porta ${porta}`);
});

// ------------------------------
// CONEXÃO COM MYSQL
// ------------------------------
const bd = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Inicializa banco e usuário admin automaticamente
async function iniciarBanco(){
  try {
    await bd.getConnection();
    console.log('✅ CONECTADO AO MYSQL COM SUCESSO!');

    // Cria admin se não existir
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, ['admin']);
    if (existe.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await bd.execute(`INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)`,
        ['admin', hash, 'admin']);
      console.log('✅ Usuário admin criado: admin / admin123');
    }
  } catch(e) {
    console.error('❌ ERRO NO BANCO:', e.message);
  }
}
iniciarBanco();

// ------------------------------
// CONFIGURAÇÕES GERAIS
// ------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/fotos', express.static(path.join(__dirname, 'pasta-fotos')));
app.set('view engine', 'ejs');
app.use(session({
  secret: process.env.SECRET || 'chave-segura-local-troque-na-nuvem',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

// ------------------------------
// UPLOAD DE FOTOS
// ------------------------------
const armazenamento = multer.diskStorage({
  destination: (req, arq, cb) => cb(null, './pasta-fotos/'),
  filename: (req, arq, cb) => cb(null, Date.now() + '-' + arq.originalname)
});
const upload = multer({ storage: armazenamento });

// ------------------------------
// MIDDLEWARE DE ACESSO
// ------------------------------
function soLogado(req, res, next) {
  if (!req.session.usuario) return res.redirect('/');
  next();
}

// ------------------------------
// ROTAS PÚBLICAS
// ------------------------------
// ✅ Tela de cadastro de usuário
// Tela de cadastro de usuário
app.get('/cadastrar-usuario', (req, res) => {
  res.render('cadastrar-usuario', {
    erro: null,
    usuarioLogado: req.session.usuario || null // ✅ Passa a variável corretamente
  });
});

// ✅ Processa o cadastro
app.post('/cadastrar-usuario', async (req, res) => {
  try {
    const { login, senha, nome, nivel } = req.body;

    // ✅ REGRAS DE SEGURANÇA:
    // Se quem está acessando NÃO é admin → força o nível como "usuario"
    let nivelFinal = 'usuario';
    if (req.session.usuario && req.session.usuario.nivel === 'admin') {
      nivelFinal = nivel || 'usuario';
    }

    // Verifica se já existe
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, [login]);
    if (existe.length > 0) {
      return res.render('cadastrar-usuario', { erro: 'Esse usuário já existe!' });
    }

    // Criptografa a senha
    const senhaCript = await bcrypt.hash(senha, 10);

    // Insere no banco com o nível definido
    await bd.execute(
      `INSERT INTO usuarios (login, senha, nome, nivel) VALUES (?, ?, ?, ?)`,
      [login, senhaCript, nome || login, nivelFinal]
    );

    res.redirect('/?sucesso=Usuário criado com sucesso!');
  } catch (erro) {
    res.render('cadastrar-usuario', { erro: 'Erro: ' + erro.message });
  }
});

app.get('/', (req, res) => res.render('login', { erro: undefined }));

app.post('/logar', async (req, res) => {
  try {
    const { login, senha } = req.body;
    const [usuarios] = await bd.execute(`SELECT * FROM usuarios WHERE login = ?`, [login]);
    const usu = usuarios[0];
    if (!usu) return res.render('login', { erro: 'Usuário não encontrado' });

    bcrypt.compare(senha, usu.senha, (erro, ok) => {
      if (!ok) return res.render('login', { erro: 'Senha incorreta' });
      req.session.usuario = { id: usu.id, login: usu.login, nivel: usu.nivel };
      res.redirect('/inicial');
    });
  } catch(e) {
    res.render('login', { erro: e.message });
  }
});

app.get('/inicial', soLogado, (req, res) => {
  res.render('inicial', { usuario: req.session.usuario });
});

app.get('/sair', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ------------------------------
// ROTAS PROTEGIDAS
// ------------------------------
app.get('/cadastro', soLogado, (req, res) => {
  res.render('cadastro', { pessoa: null, processos: [], usuario: req.session.usuario });
});

app.get('/busca', soLogado, (req, res) => {
  res.render('busca', { usuario: req.session.usuario });
});

app.get('/editar/:id', soLogado, async (req, res) => {
  const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
  const pessoa = pessoas[0];
  const [processos] = await bd.execute(`SELECT numero,data,tipificacao,descricao FROM processos_originais WHERE id_processo_unificado = ? ORDER BY id`, [req.params.id]);
  res.render('cadastro', { pessoa, processos, usuario: req.session.usuario });
});

app.get('/ver/:id', soLogado, async (req, res) => {
  try {
    const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
    const pessoa = pessoas[0];
    const [processos] = await bd.execute(`SELECT * FROM processos_originais WHERE id_processo_unificado = ? ORDER BY id`, [req.params.id]);
    res.render('cadastro', { pessoa, processos, usuario: req.session.usuario, modoVisualizacao: true });
  } catch {
    res.redirect('/busca');
  }
});

app.get('/buscar-nomes', soLogado, async (req, res) => {
  const termo = `%${req.query.nome}%`;
  const [linhas] = await bd.execute(`SELECT id, nome FROM pessoas WHERE nome LIKE ? AND ativo = 1 ORDER BY nome`, [termo]);
  res.json(linhas);
});

// ------------------------------
// SALVAR CADASTRO/ALTERAÇÃO
// ------------------------------
app.post('/salvar', soLogado, upload.array('fotos', 10), async (req, res) => {
  try {
    const dados = req.body;
    let fotos = dados.fotos_antigas || '';

    if (req.files && req.files.length > 0) {
      fotos = req.files.map(f => f.filename).join(', ');
      if (dados.fotos_antigas) {
        dados.fotos_antigas.split(',').map(f => f.trim()).filter(f => f).forEach(nome => fs.remove(caminhoPasta + nome));
      }
    }

    const numsProc = Array.isArray(req.body.proc_numero) ? req.body.proc_numero : (req.body.proc_numero ? [req.body.proc_numero] : []);
    const datasProc = Array.isArray(req.body.proc_data) ? req.body.proc_data : (req.body.proc_data ? [req.body.proc_data] : []);
    const tipsProc = Array.isArray(req.body.proc_tipificacao) ? req.body.proc_tipificacao : (req.body.proc_tipificacao ? [req.body.proc_tipificacao] : []);
    const descsProc = Array.isArray(req.body.proc_descricao) ? req.body.proc_descricao : (req.body.proc_descricao ? [req.body.proc_descricao] : []);

    async function salvarProcessosOriginais(idPessoa) {
      await bd.execute(`DELETE FROM processos_originais WHERE id_processo_unificado = ?`, [idPessoa]);
      for(let i=0; i < numsProc.length; i++){
        const num = (numsProc[i]||'').trim();
        const dt = (datasProc[i]||'').trim();
        const tip = (tipsProc[i]||'').trim();
        const desc = (descsProc[i]||'').trim();
        if(!num && !dt && !tip && !desc) continue;
        await bd.execute(
          `INSERT INTO processos_originais (id_processo_unificado,numero,data,tipificacao,descricao) 
          VALUES (?,?,?,?,?)`,[idPessoa, num, dt, tip, desc]
        );
      }
    }

    if (dados.id) {
      const [antigos] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [dados.id]);
      const antigo = antigos[0];

      await bd.execute(`UPDATE pessoas SET siapen=?,nome=?,cpf=?,rg=?,nascimento=?,mae=?,pai=?,cep=?,rua=?,numero=?,bairro=?,cidade=?,uf=?,complemento=?,processo_unificado=?,pena_total=?,data_progressao=?,fotos=? WHERE id=?`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao,fotos,dados.id]);

      await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa,dados_anteriores,dados_novos) VALUES (?,?,?,?,?)`,
        [req.session.usuario.login,'ALTERAÇÃO',dados.id,JSON.stringify(antigo),JSON.stringify({...dados,fotos})]);

      await salvarProcessosOriginais(dados.id);
      res.redirect('/busca');
    } else {
      const [result] = await bd.execute(`INSERT INTO pessoas (siapen,nome,cpf,rg,nascimento,mae,pai,cep,rua,numero,bairro,cidade,uf,complemento,processo_unificado,pena_total,data_progressao,fotos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao,fotos]);

      await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa,dados_novos) VALUES (?,?,?,?)`,
        [req.session.usuario.login,'CADASTRO NOVO',result.insertId,JSON.stringify({...dados,fotos})]);

      await salvarProcessosOriginais(result.insertId);
      res.redirect('/busca');
    }
  } catch(erro) {
    console.error('ERRO:', erro);
    res.send(`<h3>Erro: ${erro.message}</h3><a href="/cadastro">Voltar</a>`);
  }
});

// ------------------------------
// DESATIVAR / EXCLUIR
// ------------------------------
app.post('/desativar/:id', soLogado, async (req, res) => {
  await bd.execute(`UPDATE pessoas SET ativo = 0 WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa) VALUES (?,?,?)`, [req.session.usuario.login,'DESATIVAÇÃO',req.params.id]);
  res.redirect('/busca');
});

app.post('/excluir/:id', soLogado, async (req, res) => {
  if (req.session.usuario.nivel !== 'admin') return res.send('Acesso negado');
  await bd.execute(`DELETE FROM pessoas WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa) VALUES (?,?,?)`, [req.session.usuario.login,'EXCLUSÃO',req.params.id]);
  res.redirect('/busca');
});

//===============================================================================================

// CRIA TODAS AS TABELAS AUTOMATICAMENTE — USE UMA VEZ SÓ
app.get('/criar-tabelas', async (req, res) => {
  try {
    await bd.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      login VARCHAR(50) UNIQUE NOT NULL,
      senha VARCHAR(255) NOT NULL,
      nome VARCHAR(100),
      nivel ENUM('admin','usuario') DEFAULT 'usuario'
    )
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS pessoas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siapen VARCHAR(20), nome VARCHAR(150) NOT NULL,
      cpf CHAR(14) UNIQUE NOT NULL, rg VARCHAR(20),
      nascimento DATE, mae VARCHAR(150), pai VARCHAR(150),
      cep CHAR(10), rua VARCHAR(150), numero VARCHAR(10),
      bairro VARCHAR(100), cidade VARCHAR(100), uf CHAR(2),
      complemento VARCHAR(100), processo_unificado VARCHAR(50),
      pena_total VARCHAR(20), data_progressao DATE,
      fotos TEXT, ativo TINYINT DEFAULT 1
    )
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS processos_originais (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_processo_unificado INT NOT NULL,
      numero VARCHAR(50), data DATE,
      tipificacao TEXT, descricao TEXT,
      FOREIGN KEY (id_processo_unificado) REFERENCES pessoas(id) ON DELETE CASCADE
    )
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario VARCHAR(50), acao VARCHAR(50),
      id_pessoa INT, dados_anteriores TEXT, dados_novos TEXT,
      data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    `);

    res.send('✅ TODAS AS TABELAS CRIADAS COM SUCESSO! AGORA APAGUE ESSA ROTA DO CÓDIGO.');
  } catch (e) {
    res.send('ERRO: ' + e.message);
  }
});
