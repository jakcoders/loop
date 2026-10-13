package app.loop.feature.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.loop.core.database.MessageEntity

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelChatScreen(viewModel: ChatViewModel, channelName: String) {
    val messages by viewModel.messages.collectAsState(initial = emptyList())
    val typing by viewModel.typing.collectAsState()
    var textInput by remember { mutableStateOf("") }

    Scaffold(
        topBar = { TopAppBar(title = { Text("#$channelName") }) },
        bottomBar = {
            Column {
                if (typing.isNotEmpty()) {
                    Text(
                        text = "${typing.joinToString(", ")} ${if (typing.size == 1) "is" else "are"} typing…",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                    )
                }
                Surface(tonalElevation = 2.dp) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .imePadding()
                            .padding(8.dp)
                    ) {
                        TextField(
                            value = textInput,
                            onValueChange = { textInput = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Message #$channelName") },
                            maxLines = 4,
                        )
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = {
                            if (textInput.isNotBlank()) {
                                viewModel.send(textInput.trim())
                                textInput = ""
                            }
                        }) { Text("Send") }
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            reverseLayout = true, // anchors messages at the bottom
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            items(messages, key = { it.clientMessageId ?: it.id }) { msg ->
                MessageRowItem(msg)
            }
        }
    }
}

@Composable
private fun MessageRowItem(msg: MessageEntity) {
    if (msg.deletedAt != null) {
        Text(
            "This message was deleted",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        return
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row {
            Text(msg.authorName, style = MaterialTheme.typography.labelLarge)
            if (msg.pendingSync) {
                Spacer(Modifier.width(6.dp))
                Text("sending…", style = MaterialTheme.typography.labelSmall)
            }
        }
        Text(msg.body, style = MaterialTheme.typography.bodyMedium)
    }
}
