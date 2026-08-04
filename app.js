const express = require('express');
const ejs = require('ejs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const fs = require('fs-extra');

const app = express();
const caminhoPasta = path.join(__dirname, 'pasta-fotos');

// ✅ CRIA PASTA DE FOTOS AUTOMATICAMENTE SE NÃO EXISTIR
fs.ensureDirSync(caminhoPasta);

// ------------------------------
// CONEXÃO BANCO — LOCAL E ONLINE
// ------------------------------
const bd = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'sistema_cadastro',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Inicializa banco e usuário admin automaticamente
async function iniciarBanco(){
  try {
    console.log('========================================');
    console.log('🔍 CONECTANDO AO BANCO DE DADOS...');
    const conn = await bd.getConnection();
    console.log('✅ CONECTADO AO MYSQL COM SUCESSO!');
    console.log('   Thread ID:', conn.threadId);
    conn.release();

    // Cria admin se não existir
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, ['admin']);
    if (existe.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await bd.execute(`INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)`,
        ['admin', hash, 'admin']);
      console.log('✅ Usuário admin criado: admin / admin123');
    } else {
      console.log('ℹ️ Usuário admin já existe.');
    }

  } catch(e) {
    console.error('========================================');
    console.error('❌ ERRO NO BANCO:', e.message);
    console.error('========================================');
  }
}
iniciarBanco();

// ------------------------------
// 🛑 SESSÃO — CORRIGIDA PARA FUNCIONAR LOCAL E ONLINE
// ------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'sistema-cadastro-seguro-2026-alterar-em-producao',
  resave: false,
  saveUninitialized: false,
  proxy: true, // ✅ Habilita para servidores online
  cookie: {
    secure: process.env.NODE_ENV === 'production', // ✅ Automático: true se HTTPS, false se local
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 // 1 dia
  }
}));

// ------------------------------
// CONFIGURAÇÕES GERAIS
// ------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/fotos', express.static(caminhoPasta));
app.set('view engine', 'ejs');

// ------------------------------
// UPLOAD DE ARQUIVOS
// ------------------------------
const armazenamento = multer.diskStorage({
  destination: (req, arq, cb) => cb(null, caminhoPasta),
  filename: (req, arq, cb) => cb(null, Date.now() + '-' + arq.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: armazenamento, limits: { fileSize: 5 * 1024 * 1024 } });

// ------------------------------
// MIDDLEWARE DE PROTEÇÃO
// ------------------------------
function soLogado(req, res, next) {
  if (!req.session.usuario){
    console.log('🔒 ACESSO NEGADO:', req.path);
    return res.redirect('/');
  }
  next();
}

// ------------------------------
// ROTAS PÚBLICAS
// ------------------------------
app.get('/', (req, res) => res.render('login', { erro: undefined, sucesso: req.query.sucesso || null }));

app.post('/logar', async (req, res) => {
  try {
    const { login, senha } = req.body;
    const [usuarios] = await bd.execute(`SELECT * FROM usuarios WHERE login = ?`, [login]);
    const usu = usuarios[0];
    if (!usu) return res.render('login', { erro: 'Usuário não encontrado' });

    const senhaCorreta = await bcrypt.compare(senha, usu.senha);
    if (!senhaCorreta) return res.render('login', { erro: 'Senha incorreta' });

    // ✅ Salva os dados corretamente na sessão
    req.session.usuario = { 
      id: usu.id, 
      login: usu.login, 
      nome: usu.nome || usu.login,
      nivel: usu.nivel 
    };

    // ✅ Garante que a sessão está salva antes de redirecionar
    req.session.save((erroSalva) => {
      if (erroSalva) {
        console.error('❌ ERRO AO SALVAR SESSÃO:', erroSalva);
        return res.render('login', { erro: 'Erro ao autenticar, tente novamente' });
      }
      res.redirect('/inicial');
    });

  } catch(e) {
    console.error('❌ ERRO NO LOGIN:', e);
    res.render('login', { erro: e.message });
  }
});

app.get('/cadastrar-usuario', (req, res) => {
  res.render('cadastrar-usuario', {
    erro: null,
    sucesso: req.query.sucesso || null,
    usuarioLogado: req.session.usuario || null
  });
});

app.post('/cadastrar-usuario', async (req, res) => {
  try {
    const { login, senha, nome, nivel } = req.body;
    let nivelFinal = 'usuario';
    if (req.session.usuario && req.session.usuario.nivel === 'admin') {
      nivelFinal = nivel || 'usuario';
    }

    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, [login]);
    if (existe.length > 0) {
      return res.render('cadastrar-usuario', { 
        erro: 'Esse usuário já existe!', 
        sucesso: null,
        usuarioLogado: req.session.usuario || null 
      });
    }

    const senhaCript = await bcrypt.hash(senha, 10);
    await bd.execute(`INSERT INTO usuarios (login, senha, nome, nivel) VALUES (?, ?, ?, ?)`, 
      [login, senhaCript, nome || login, nivelFinal]);

    res.redirect('/?sucesso=Usuário criado com sucesso! Faça seu login.');
  } catch (erro) {
    res.render('cadastrar-usuario', { 
      erro: 'Erro: ' + erro.message, 
      sucesso: null,
      usuarioLogado: req.session.usuario || null 
    });
  }
});

// ------------------------------
// ROTAS PROTEGIDAS
// ------------------------------
app.get('/inicial', soLogado, (req, res) => res.render('inicial', { usuario: req.session.usuario }));
app.get('/sair', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/cadastro', soLogado, (req, res) => res.render('cadastro', { pessoa: null, processos: [], usuario: req.session.usuario }));
app.get('/busca', soLogado, (req, res) => res.render('busca', { usuario: req.session.usuario }));

app.get('/editar/:id', soLogado, async (req, res) => {
  const [p] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
  const [proc] = await bd.execute(`SELECT * FROM processos_originais WHERE id_processo_unificado = ?`, [req.params.id]);
  res.render('cadastro', { pessoa: p[0], processos: proc, usuario: req.session.usuario });
});

app.get('/ver/:id', soLogado, async (req, res) => {
  try {
    const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
    const pessoa = pessoas[0];
    if (!pessoa) return res.redirect('/busca');
    
    // ✅ Consulta correta para pegar os processos
    const [processos] = await bd.execute(
      `SELECT * FROM processos_originais WHERE id_processo_unificado = ? ORDER BY id`, 
      [req.params.id]
    );

    // ✅ Envia os nomes CORRETOS para a tela
    res.render('ver', { 
      pessoa, 
      processos, 
      usuarioLogado: req.session.usuario 
    });
  } catch (erro) {
    console.error('ERRO NA TELA VER:', erro);
    res.redirect('/busca');
  }
});

app.get('/buscar-nomes', soLogado, async (req, res) => {
  const termo = `%${req.query.nome || ''}%`;
  const [linhas] = await bd.execute(`SELECT id, nome FROM pessoas WHERE nome LIKE ? AND ativo = 1 ORDER BY nome LIMIT 50`, [termo]);
  res.json(linhas);
});

// ------------------------------
// SALVAR CADASTRO / EDIÇÃO
// ------------------------------
app.post('/salvar', soLogado, upload.array('fotos', 10), async (req, res) => {
  const conn = await bd.getConnection();
  try {
    await conn.beginTransaction(); // Transação: salva tudo ou nada
    const dados = req.body;
    let fotos = dados.fotos_antigas || '';

    if (req.files && req.files.length > 0) {
      const novasFotos = req.files.map(f => f.filename).join(', ');
      fotos = novasFotos;
      if (dados.fotos_antigas) {
        dados.fotos_antigas.split(',').map(f => f.trim()).filter(f => f).forEach(nome => {
          fs.remove(path.join(caminhoPasta, nome)).catch(err => console.warn('Arquivo não encontrado:', nome));
        });
      }
    }

    // Trata arrays de processos
    const numsProc = Array.isArray(req.body.proc_numero) ? req.body.proc_numero : (req.body.proc_numero ? [req.body.proc_numero] : []);
    const datasProc = Array.isArray(req.body.proc_data) ? req.body.proc_data : (req.body.proc_data ? [req.body.proc_data] : []);
    const tipsProc = Array.isArray(req.body.proc_tipificacao) ? req.body.proc_tipificacao : (req.body.proc_tipificacao ? [req.body.proc_tipificacao] : []);
    const descsProc = Array.isArray(req.body.proc_descricao) ? req.body.proc_descricao : (req.body.proc_descricao ? [req.body.proc_descricao] : []);

    async function salvarProcessosOriginais(idPessoa) {
      await conn.execute(`DELETE FROM processos_originais WHERE id_processo_unificado = ?`, [idPessoa]);
      for(let i=0; i < numsProc.length; i++){
        const num = (numsProc[i]||'').trim();
        const dt = (datasProc[i]||'').trim();
        const tip = (tipsProc[i]||'').trim();
        const desc = (descsProc[i]||'').trim();
        if(!num && !dt && !tip && !desc) continue;
        await conn.execute(
          `INSERT INTO processos_originais (id_processo_unificado,numero,data,tipificacao,descricao) 
          VALUES (?,?,?,?,?)`,[idPessoa, num, dt || null, tip, desc]
        );
      }
    }

    if (dados.id) {
      // 📝 EDIÇÃO
      const [antigos] = await conn.execute(`SELECT * FROM pessoas WHERE id = ?`, [dados.id]);
      if (!antigos[0]) throw new Error('Registro não encontrado!');

      await conn.execute(`UPDATE pessoas SET siapen=?,nome=?,cpf=?,rg=?,nascimento=?,mae=?,pai=?,cep=?,rua=?,numero=?,bairro=?,cidade=?,uf=?,complemento=?,processo_unificado=?,pena_total=?,data_progressao=?,fotos=? WHERE id=?`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento||null,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao||null,fotos,dados.id]);

      await conn.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa,dados_anteriores,dados_novos) VALUES (?,?,?,?,?)`,
        [req.session.usuario.login,'ALTERAÇÃO',dados.id,JSON.stringify(antigos[0]),JSON.stringify({...dados,fotos})]);

      await salvarProcessosOriginais(dados.id);
    } else {
      // 🆕 NOVO CADASTRO
      await conn.execute(`INSERT INTO pessoas (siapen,nome,cpf,rg,nascimento,mae,pai,cep,rua,numero,bairro,cidade,uf,complemento,processo_unificado,pena_total,data_progressao,fotos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento||null,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao||null,fotos]);

      const [result] = await conn.execute(`SELECT LAST_INSERT_ID() as id`);
      const novoId = result[0].id;

      await conn.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa,dados_novos) VALUES (?,?,?,?)`,
        [req.session.usuario.login,'CADASTRO NOVO',novoId,JSON.stringify({...dados,fotos})]);

      await salvarProcessosOriginais(novoId);
    }

    await conn.commit();
    res.redirect('/busca');

  } catch(erro) {
    await conn.rollback();
    console.error('❌ ERRO AO SALVAR:', erro);

    // 🎯 TRATAMENTO INTELIGENTE DOS ERROS
    let mensagemErro = 'Ocorreu um erro ao salvar, verifique os dados!';
    let tipoErro = 'erro'; // erro / aviso / sucesso

    if (erro.code === 'ER_DUP_ENTRY') {
      if (erro.message.includes('pessoas.cpf')) {
        mensagemErro = `⚠️ O CPF ${dados.cpf} já está cadastrado no sistema!`;
        tipoErro = 'aviso';
      } else if (erro.message.includes('pessoas.processo_unificado')) {
        mensagemErro = `⚠️ O número de processo ${dados.processo_unificado} já está cadastrado!`;
        tipoErro = 'aviso';
      } else {
        mensagemErro = `⚠️ Registro duplicado: algum dado único já existe no sistema!`;
        tipoErro = 'aviso';
      }
    } else if (erro.message.includes('não encontrado')) {
      mensagemErro = `❌ ${erro.message}`;
    } else {
      mensagemErro = `❌ Erro: ${erro.message}`;
    }

    // 🚫 VOLTA PARA A TELA COM DADOS PREENCHIDOS E MENSAGEM
    return res.render('cadastro', {
      pessoa: { ...dados, fotos },
      processos: numsProc.map((num, i) => ({
        numero: num,
        data: datasProc[i],
        tipificacao: tipsProc[i],
        descricao: descsProc[i]
      })),
      usuario: req.session.usuario,
      erro: mensagemErro,
      tipoErro: tipoErro
    });

  } finally {
    conn.release();
  }
});

// ------------------------------
// AÇÕES ADMINISTRATIVAS
// ------------------------------
app.post('/desativar/:id', soLogado, async (req, res) => {
  await bd.execute(`UPDATE pessoas SET ativo=0 WHERE id=?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria VALUES (NULL,?,?,?,NULL,NULL,NOW())`, [req.session.usuario.login,'DESATIVAÇÃO',req.params.id]);
  res.redirect('/busca');
});

app.post('/excluir/:id', soLogado, async (req, res) => {
  if (req.session.usuario.nivel !== 'admin') return res.status(403).send('Acesso negado');
  await bd.execute(`DELETE FROM pessoas WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa) VALUES (?,?,?)`, [req.session.usuario.login,'EXCLUSÃO',req.params.id]);
  res.redirect('/busca');
});

// ------------------------------
// ROTAS TEMPORÁRIAS (USAR 1 VEZ)
// ------------------------------
app.get('/criar-tabelas', async (req, res) => {
  try {
    await bd.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      login VARCHAR(50) UNIQUE NOT NULL,
      senha VARCHAR(255) NOT NULL,
      nome VARCHAR(100),
      nivel ENUM('admin','usuario') DEFAULT 'usuario'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS processos_originais (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_processo_unificado INT NOT NULL,
      numero VARCHAR(50), data DATE,
      tipificacao TEXT, descricao TEXT,
      FOREIGN KEY (id_processo_unificado) REFERENCES pessoas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario VARCHAR(50), acao VARCHAR(50),
      id_pessoa INT, dados_anteriores TEXT, dados_novos TEXT,
      data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    res.send('✅ TODAS AS TABELAS CRIADAS COM SUCESSO! <br><br><a href="/criar-admin">Criar usuário admin</a>');
  } catch (e) {
    res.send('❌ ERRO: ' + e.message);
  }
});

app.get('/criar-admin', async (req, res) => {
  try {
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, ['admin']);
    if (existe.length > 0) {
      return res.send('✅ Admin já existe! <br><br><a href="/">Ir para login</a>');
    }
    const hash = await bcrypt.hash('admin123', 10);
    await bd.execute(`INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
    res.send('✅ Usuário admin criado com sucesso! <br><br>🔑 Login: <b>admin</b><br>🔒 Senha: <b>admin123</b><br><br><a href="/">Ir para login</a>');
  } catch (e) {
    res.send('❌ ERRO: ' + e.message);
  }
});

// ------------------------------
// INICIA O SERVIDOR
// ------------------------------
const porta = process.env.PORT || 3000;
app.listen(porta, () => {
  console.log(`✅ Sistema rodando na porta ${porta}`);
  console.log(`🔗 Acesse: http://localhost:${porta}`);
  console.log(`🔑 Login padrão: admin / admin123`);
}).on('error', (erro) => {
  console.error('❌ Erro ao iniciar servidor:', erro.message);
  process.exit(1);
});
