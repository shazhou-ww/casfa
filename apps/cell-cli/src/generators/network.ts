import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";

export function generateNetwork(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};

  if (!config.network?.vpc) return { Resources: resources };

  const name = config.name;

  resources.LambdaVpc = {
    Type: "AWS::EC2::VPC",
    Properties: {
      CidrBlock: "10.0.0.0/16",
      EnableDnsSupport: true,
      EnableDnsHostnames: true,
      Tags: [{ Key: "Name", Value: `${name}-vpc` }],
    },
  };

  resources.PrivateSubnetA = {
    Type: "AWS::EC2::Subnet",
    Properties: {
      VpcId: { Ref: "LambdaVpc" },
      CidrBlock: "10.0.1.0/24",
      AvailabilityZone: { "Fn::Select": [0, { "Fn::GetAZs": "" }] },
      Tags: [{ Key: "Name", Value: `${name}-private-a` }],
    },
  };

  resources.PrivateSubnetB = {
    Type: "AWS::EC2::Subnet",
    Properties: {
      VpcId: { Ref: "LambdaVpc" },
      CidrBlock: "10.0.2.0/24",
      AvailabilityZone: { "Fn::Select": [1, { "Fn::GetAZs": "" }] },
      Tags: [{ Key: "Name", Value: `${name}-private-b` }],
    },
  };

  resources.PrivateRouteTable = {
    Type: "AWS::EC2::RouteTable",
    Properties: {
      VpcId: { Ref: "LambdaVpc" },
      Tags: [{ Key: "Name", Value: `${name}-private-rt` }],
    },
  };

  resources.PrivateSubnetARouteTableAssociation = {
    Type: "AWS::EC2::SubnetRouteTableAssociation",
    Properties: {
      SubnetId: { Ref: "PrivateSubnetA" },
      RouteTableId: { Ref: "PrivateRouteTable" },
    },
  };

  resources.PrivateSubnetBRouteTableAssociation = {
    Type: "AWS::EC2::SubnetRouteTableAssociation",
    Properties: {
      SubnetId: { Ref: "PrivateSubnetB" },
      RouteTableId: { Ref: "PrivateRouteTable" },
    },
  };

  resources.LambdaSecurityGroup = {
    Type: "AWS::EC2::SecurityGroup",
    Properties: {
      GroupDescription: `Security group for ${name} Lambda functions`,
      VpcId: { Ref: "LambdaVpc" },
      SecurityGroupEgress: [
        { IpProtocol: "-1", CidrIp: "0.0.0.0/0" },
      ],
    },
  };

  outputs.VpcId = {
    Value: { Ref: "LambdaVpc" },
    Export: { Name: `${name}-VpcId` },
  };
  outputs.PrivateSubnetA = {
    Value: { Ref: "PrivateSubnetA" },
    Export: { Name: `${name}-PrivateSubnetA` },
  };
  outputs.PrivateSubnetB = {
    Value: { Ref: "PrivateSubnetB" },
    Export: { Name: `${name}-PrivateSubnetB` },
  };
  outputs.LambdaSecurityGroup = {
    Value: { Ref: "LambdaSecurityGroup" },
    Export: { Name: `${name}-LambdaSecurityGroup` },
  };

  if (config.network.nat) {
    resources.PublicSubnet = {
      Type: "AWS::EC2::Subnet",
      Properties: {
        VpcId: { Ref: "LambdaVpc" },
        CidrBlock: "10.0.0.0/24",
        AvailabilityZone: { "Fn::Select": [0, { "Fn::GetAZs": "" }] },
        MapPublicIpOnLaunch: true,
        Tags: [{ Key: "Name", Value: `${name}-public` }],
      },
    };

    resources.InternetGateway = {
      Type: "AWS::EC2::InternetGateway",
      Properties: {
        Tags: [{ Key: "Name", Value: `${name}-igw` }],
      },
    };

    resources.InternetGatewayAttachment = {
      Type: "AWS::EC2::VPCGatewayAttachment",
      Properties: {
        VpcId: { Ref: "LambdaVpc" },
        InternetGatewayId: { Ref: "InternetGateway" },
      },
    };

    resources.PublicRouteTable = {
      Type: "AWS::EC2::RouteTable",
      Properties: {
        VpcId: { Ref: "LambdaVpc" },
        Tags: [{ Key: "Name", Value: `${name}-public-rt` }],
      },
    };

    resources.PublicRoute = {
      Type: "AWS::EC2::Route",
      DependsOn: "InternetGatewayAttachment",
      Properties: {
        RouteTableId: { Ref: "PublicRouteTable" },
        DestinationCidrBlock: "0.0.0.0/0",
        GatewayId: { Ref: "InternetGateway" },
      },
    };

    resources.PublicSubnetRouteTableAssociation = {
      Type: "AWS::EC2::SubnetRouteTableAssociation",
      Properties: {
        SubnetId: { Ref: "PublicSubnet" },
        RouteTableId: { Ref: "PublicRouteTable" },
      },
    };

    resources.NatGatewayEip = {
      Type: "AWS::EC2::EIP",
      Properties: { Domain: "vpc" },
    };

    resources.NatGateway = {
      Type: "AWS::EC2::NatGateway",
      Properties: {
        AllocationId: { "Fn::GetAtt": ["NatGatewayEip", "AllocationId"] },
        SubnetId: { Ref: "PublicSubnet" },
        Tags: [{ Key: "Name", Value: `${name}-nat` }],
      },
    };

    resources.PrivateRoute = {
      Type: "AWS::EC2::Route",
      Properties: {
        RouteTableId: { Ref: "PrivateRouteTable" },
        DestinationCidrBlock: "0.0.0.0/0",
        NatGatewayId: { Ref: "NatGateway" },
      },
    };

    outputs.NatGatewayPublicIp = {
      Value: { Ref: "NatGatewayEip" },
      Export: { Name: `${name}-NatGatewayPublicIp` },
    };
  }

  return { Resources: resources, Outputs: outputs };
}
