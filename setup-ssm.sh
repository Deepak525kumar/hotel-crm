aws iam create-role --role-name SSMInstanceRole --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}'
aws iam attach-role-policy --role-name SSMInstanceRole --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name SSMInstanceProfile
aws iam add-role-to-instance-profile --instance-profile-name SSMInstanceProfile --role-name SSMInstanceRole
sleep 5
aws ec2 associate-iam-instance-profile --instance-id i-00a27148d4660cb45 --iam-instance-profile Name=SSMInstanceProfile
