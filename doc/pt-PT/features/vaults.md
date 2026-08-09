# Cofres

Cofres são contentores isolados que armazenam contactos e os seus dados associados. Fornecem separação segura de dados e controlo de acesso para definições com vários utilizadores.

## Por que Cofres?

- **Isolamento de dados**: Contactos em diferentes cofres são separados, com exceção de [relacionamentos entre cofres](/pt-PT/features/contacts#relacionamentos-entre-cofres).
- **Acesso compartilhado**: Convide outros utilizadores para colaborar no mesmo cofre.
- **Permissões baseadas em funções**: Controlo sobre quem pode fazer o quê.

## Funções

Cada utilizador num cofre tem uma de três funções:

| Função | Permissões |
|--------|------------|
| **Gestor** | Acesso total: criar, editar, eliminar contactos e definições do cofre. Pode convidar outros. |
| **Editor** | Pode criar e editar contactos, mas não pode gerir definições do cofre ou utilizadores. |
| **Leitor** | Acesso só de leitura aos contactos. Não pode modificar nada. |

## Criar um Cofre

Após o login, crie o seu primeiro cofre a partir do painel. Dê-lhe um nome e descrição opcional. O criador torna-se automaticamente o **Gestor**.

## Definições do Cofre

Cada cofre tem o seu próprio conjunto de padrões, semeados na criação:

- **Tipos de data importantes**: Data de nascimento, data de falecimento (incorporado), além de tipos personalizados.
- **Parâmetros de registo de humor**: Escala de humor de 5 níveis com emoji e cores.
- **Categorias de eventos da vida**: 4 categorias com 20 tipos de eventos.
- **Modelos de fatos rápidos**: Como nos conhecemos, hobbies, preferências alimentares.

## Utilizadores do Sistema e Contactos

Membros do cofre e contactos são conceitos independentes. Criar ou aderir a um cofre nunca cria um contacto para o utilizador do sistema.
- **Associação e permissões**: `UserVault` apenas associa um utilizador do sistema ao cofre e guarda a sua função.
- **Registo de humor**: Os registos de humor pertencem diretamente ao utilizador atual dentro do cofre.
- **Eventos da vida**: Eventos criados no painel guardam o utilizador do sistema como sujeito. Participantes opcionais são contactos comuns e apenas estes recebem o evento nas suas linhas cronológicas.

## Painel do Cofre

O espaço de trabalho principal num cofre é um painel responsivo de três colunas:

### Coluna Esquerda
Exibe os seus **Contactos Recentes** e **Mais Consultados** para acesso rápido. Esta coluna fica oculta em ecrãs de tablet pequeno.

### Coluna Central
Apresenta um controlo Segmentado para alternar entre três abas dinâmicas. O separador selecionado é persistido no servidor usando a configuração `defaultTab`, carregando o separador preferido automaticamente na próxima visita.
1. **Atividades**: Um feed mostrando alterações recentes e ações tomadas por utilizadores neste cofre.
2. **Eventos da Vida**: Uma visão geral de todos os eventos da vida no cofre. Eventos criados no painel identificam o utilizador do sistema como sujeito e podem incluir contactos opcionais; esses eventos também aparecem na linha cronológica de cada participante.
3. **Métricas da Vida**: Registos simples de eventos monitorizando métricas personalizadas. Clique em "+1" para registar uma ocorrência. Clique em detalhes para ver um gráfico de barras mensal dos eventos registados.

### Coluna Direita
Contém widgets para:
- **Registo de Humor**: Registe o seu humor numa escala de cinco pontos. O registo fica associado ao utilizador do sistema e ao cofre atual.
- **Lembretes Próximos**: Lembretes que se aproximam em breve.
- **Tarefas Pendentes**: Tarefas abertas que exigem a sua atenção.

## Arquitetura de Métricas da Vida

Em vez de anexar números diretamente a contactos, as Métricas da Vida usam um padrão de registo de eventos. Clicar em "+1" regista uma nova entrada de evento com timestamp na base de dados. Estatísticas mensais contam esses registos para apresentar gráficos de barras na página de detalhes da métrica.

## Convidar Utilizadores

Gestores do cofre podem convidar outros utilizadores para entrar no cofre através do sistema de Convites de Utilizador. Cada convite especifica um nível de permissão.

## Alternar Cofres

Se tem acesso a vários cofres, use o seletor de cofres na barra de navegação para alternar entre eles. Cada cofre mantém a sua própria lista de contactos, definições e índice de pesquisa.
