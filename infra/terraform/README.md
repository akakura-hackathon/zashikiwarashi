# Infra (Terraform)

シングル環境（dev/stg/prodを分けない）でGCPリソースを管理する。方針は `.agents/rules/infra.md` を参照。

## Usage
```
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

## Apply後の作業
<!-- terraform output の値をどこにコピーするか（GitHub Variables/Secrets等） -->
