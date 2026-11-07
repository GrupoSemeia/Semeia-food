# Levantamento de requisitos — Hot Dog Yracema

Fonte: questionário respondido por Guilherme Klucovski (sócio), 15/09/2026.

## Contexto
- 7 lojas próprias (Curitiba, Araucária, São José dos Pinhais, Fazenda Rio Grande); meta de 10+ em 2 anos; o sistema deve absorver novas unidades automaticamente.
- Cozinha central (sem padaria própria), com setores: salada, maionese, pão, câmaras frias, carnes, depósito de embalagens. A lista de produção vai para o motorista que abastece as lojas.
- Hoje: PDV Connect Plug em cada loja + planilhas Excel online + WhatsApp.

## Dores
1. Fechamento diário vai para planilha e o fechamento mensal sempre diverge.
2. Pedido diário na planilha compartilhada: erros de lançamento e uma gestora limpa/salva a planilha à mão todo dia.
3. Sem controle de produção, estoque, perdas ou inventário.

## Prioridades (todas "1 – muito alta"): pedido de produção, produção, estoque, fechamento de caixa, relatórios, app mobile.
Módulo indispensável da v1 segundo o cliente: **Relatórios**. Resultado esperado: fechamento de caixa padronizado e fácil, para a loja e para o gestor no fim do mês.

## Escopo por fase
| Requisito do cliente | MVP | Fase 2 |
|---|---|---|
| Pedido diário (gerente, ~22h, ~85 produtos, muda por dia da semana) | ✅ pedido por data + consolidação | sugestão de pedido por dia da semana |
| Conferência antes da produção | ✅ consolidado por loja/produto + lojas sem pedido | fluxo de aprovação |
| Produção por setor / lista do motorista | consolidado impresso | ✅ divisão por setor e rota |
| Estoque central e por loja, perdas, inventário | — | ✅ |
| Fechamento: formas de pagamento, sangria, despesa, cancelamento, estorno | ✅ | — |
| Anexar relatório da maquininha / sistema / comprovantes | totais digitados | ✅ fotos (R2) |
| Conferência por gestores | ✅ conferir / reabrir | — |
| Relatórios diário/semanal/mensal/loja/produto em Excel | ✅ | financeiro, produção, estoque |
| Perfis: gerente, financeiro, administração, diretor, proprietário (cada um vê o seu) | ✅ | permissões finas |
| Alertas: loja sem pedido/fechamento, estoque baixo, divergência | painel (visual) | ✅ push/WhatsApp |
| Offline | ✅ fila automática | — |
| Câmera / GPS | não necessários | — |
| Lucro, consumo, despesas (dashboard) | — | ✅ |
| Integrações (Connect Plug, iFood, ERP, banco) | nenhuma solicitada | Connect Plug/iFood sob consulta |

## Pontos em aberto para o cliente
- O Connect Plug exporta/expõe API? (define se a fase 2 pode trazer o total do sistema automaticamente)
- Horário de travamento do pedido e quem pode alterar depois.
- O pedido muda por dia da semana: pretendem quantidades-padrão por dia?
- "Despesa" sai sempre do dinheiro do caixa?
