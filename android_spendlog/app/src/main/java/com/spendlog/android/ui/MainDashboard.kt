package com.spendlog.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.spendlog.android.data.Transaction
import kotlinx.coroutines.flow.Flow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainDashboard(
    transactionsFlow: Flow<List<Transaction>>,
    onTransactionClick: (Transaction) -> Unit,
    onAddTransactionClick: () -> Unit,
) {
    val transactions by transactionsFlow.collectAsState(initial = emptyList())

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("SpendLog Dashboard") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAddTransactionClick) {
                Icon(Icons.Default.Add, contentDescription = "Add")
            }
        },
    ) { paddingValues ->
        Column(modifier = Modifier.padding(paddingValues)) {
            SummaryCard(transactions)
            RecentTransactionsList(transactions, onTransactionClick)
        }
    }
}

@Composable
fun SummaryCard(transactions: List<Transaction>) {
    val totalExpense = transactions.filter { it.type == "EXPENSE" }.sumOf { it.amount }
    val totalIncome = transactions.filter { it.type == "INCOME" }.sumOf { it.amount }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "This Month Summary", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            Text(text = "Total Expense: ${totalExpense.toLocaleString()}원", color = MaterialTheme.colorScheme.error)
            Text(text = "Total Income: ${totalIncome.toLocaleString()}원", color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
fun RecentTransactionsList(transactions: List<Transaction>, onTransactionClick: (Transaction) -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Text(
                text = "Recent Transactions",
                modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.titleSmall,
            )
        }
        items(transactions) { transaction ->
            TransactionItem(transaction, onTransactionClick)
        }
    }
}

@Composable
fun TransactionItem(transaction: Transaction, onClick: (Transaction) -> Unit) {
    ListItem(
        headlineContent = { Text(transaction.merchant) },
        supportingContent = { Text("${transaction.datetime} | ${transaction.payMethod}") },
        trailingContent = {
            Text(
                text = "${if (transaction.type == "EXPENSE") "-" else "+"}${transaction.amount.toLocaleString()}원",
                color = if (transaction.type == "EXPENSE") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
        },
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick(transaction) },
    )
}

// Helper extension
fun Long.toLocaleString(): String {
    return "%,d".format(this)
}
