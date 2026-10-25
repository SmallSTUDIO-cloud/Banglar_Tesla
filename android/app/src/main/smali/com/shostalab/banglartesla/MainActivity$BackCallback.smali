.class final Lcom/shostalab/banglartesla/MainActivity$BackCallback;
.super Ljava/lang/Object;
.source "MainActivity.java"
.implements Landroid/webkit/ValueCallback;

.field private final activity:Lcom/shostalab/banglartesla/MainActivity;

.method constructor <init>(Lcom/shostalab/banglartesla/MainActivity;)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/shostalab/banglartesla/MainActivity$BackCallback;->activity:Lcom/shostalab/banglartesla/MainActivity;
    return-void
.end method

.method public bridge synthetic onReceiveValue(Ljava/lang/Object;)V
    .locals 0

    check-cast p1, Ljava/lang/String;
    invoke-virtual {p0, p1}, Lcom/shostalab/banglartesla/MainActivity$BackCallback;->onReceiveValue(Ljava/lang/String;)V
    return-void
.end method

.method public onReceiveValue(Ljava/lang/String;)V
    .locals 1

    const-string v0, "true"
    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-nez v0, :cond_handled
    iget-object v0, p0, Lcom/shostalab/banglartesla/MainActivity$BackCallback;->activity:Lcom/shostalab/banglartesla/MainActivity;
    invoke-virtual {v0}, Lcom/shostalab/banglartesla/MainActivity;->finish()V

    :cond_handled
    return-void
.end method
