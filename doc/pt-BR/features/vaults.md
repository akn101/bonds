# Cofres

Cofres são contêineres isolados que armazenam contatos e seus dados associados. Eles fornecem separação segura de dados e controle de acesso para configurações com vários usuários.

## Por que Cofres?

- **Isolamento de dados**: Contatos em diferentes cofres são separados, com exceção de [relacionamentos entre cofres](/pt-BR/features/contacts#relacionamentos-entre-cofres).
- **Acesso compartilhado**: Convide outros usuários para colaborar no mesmo cofre.
- **Permissões baseadas em funções**: Controle quem pode fazer o quê.

## Funções

Cada usuário em um cofre tem uma de três funções:

| Função | Permissões |
|--------|------------|
| **Gerente** | Acesso total: criar, editar, excluir contatos e configurações do cofre. Pode convidar outros. |
| **Editor** | Pode criar e editar contatos, mas não pode gerenciar configurações do cofre ou usuários. |
| **Visualizador** | Acesso somente leitura aos contatos. Não pode modificar nada. |

## Criando um Cofre

Após o login, crie seu primeiro cofre a partir do painel. Dê a ele um nome e descrição opcional. O criador se torna automaticamente o **Gerente**.

## Configurações do Cofre

Cada cofre tem seu próprio conjunto de padrões, semeados na criação:

- **Tipos de data importantes**: Data de nascimento, data de falecimento (incorporado), além de tipos personalizados.
- **Parâmetros de registro de humor**: Escala de humor de 5 níveis com emoji e cores.
- **Categorias de atividades**: 4 categorias com 20 tipos de atividades.
- **Modelos de fatos rápidos**: Como nos conhecemos, hobbies, preferências alimentares.

## Usuários do Sistema e Contatos

Membros do cofre e contatos são conceitos independentes. Criar ou ingressar em um cofre nunca cria um contato para o usuário do sistema.
- **Associação e permissões**: `UserVault` apenas vincula um usuário do sistema ao cofre e armazena sua função.
- **Registro de humor**: Os registros de humor pertencem diretamente ao usuário atual dentro do cofre.
- **Atividades**: Atividades criadas no painel armazenam o usuário do sistema como sujeito. Participantes opcionais são contatos comuns e somente eles recebem a atividade em suas linhas do tempo.

## Painel do Cofre

O espaço de trabalho principal em um cofre é um painel responsivo de três colunas:

### Coluna Esquerda
Exibe seus **Contatos Recentes** e **Mais Consultados** para acesso rápido. Esta coluna fica oculta em telas de tablet pequeno.

### Coluna Central
Apresenta um controle Segmentado para alternar entre três abas dinâmicas. Sua aba selecionada é persistida no servidor usando `default-dashboard-tab`, carregando sua aba preferida automaticamente na próxima visita.
1. **Feed**: Alterações recentes e ações tomadas por usuários neste cofre.
2. **Atividades**: Uma visão geral de todas as atividades no cofre. Atividades criadas no painel identificam o usuário do sistema como sujeito e podem incluir contatos opcionais; essas atividades também aparecem na linha do tempo de cada participante.
3. **Métricas da Vida**: Registros simples de eventos rastreando métricas personalizadas. Clique em "+1" para registrar uma ocorrência. Clique em detalhes para ver um gráfico de barras mensal dos eventos registrados.

### Coluna Direita
Contém widgets para:
- **Registro de Humor**: Registre seu humor em uma escala de cinco pontos. O registro é vinculado ao usuário do sistema e ao cofre atual.
- **Próximos Lembretes**: Lembretes que se aproximam em breve.
- **Tarefas Pendentes**: Tarefas abertas que exigem sua atenção.

## Arquitetura de Métricas da Vida

Em vez de anexar números diretamente a contatos, as Métricas da Vida usam um padrão de registro de eventos. Clicar em "+1" registra uma nova entrada de evento com timestamp no banco de dados. Estatísticas mensais contam esses registros para renderizar gráficos de barras na página de detalhes da métrica.

## Convidando Usuários

Gerentes de cofre podem convidar outros usuários para entrar no cofre através do sistema de Convites de Usuário. Cada convite especifica um nível de permissão.

## Alternando Cofres

Se você tem acesso a vários cofres, use o seletor de cofres na barra de navegação para alternar entre eles. Cada cofre mantém sua própria lista de contatos, configurações e índice de busca.
